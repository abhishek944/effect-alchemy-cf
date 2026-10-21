import type * as cf from "@cloudflare/workers-types";
import type { ImageMemoryLease } from "./chat-image-memory.ts";
import type {
  ImageGenerationTransport,
  ImageGenerationTransportScope,
} from "./chat-image-binding.ts";
import { hydrateImageRequest } from "./chat-image-hydration.ts";
import type { HydratedImageRequest } from "./chat-image-hydration-types.ts";
import { prepareLegacyTextGeneration } from "./chat-image-generation-legacy.ts";
import { remapImageGenerationProof } from "./chat-image-generation-remap.ts";
import { canonicalImageGenerationContext } from "./chat-image-generation-policy.ts";
import {
  imageGenerationContext,
  IMAGE_GENERATION_INCOMPLETE,
  verifyImageGenerationState,
} from "./chat-image-generation-state.ts";
import type {
  GenerationRequestProof,
  ImageNativeContext,
  ImageRequestAccess,
  ImageRequestBridge,
} from "./chat-image-request-types.ts";
import type { ConversationSkills } from "./chat-skills-runtime.ts";
import type { SkillRequestGuard } from "./chat-skills-guard.ts";

export type ImageGenerationDependencies = {
  readonly request: ImageRequestAccess;
  readonly bridge: ImageRequestBridge;
  readonly skills: Pick<ConversationSkills, "prepareRequestFor">;
  readonly context: ImageNativeContext;
  readonly transport: ImageGenerationTransport;
  readonly catalog?: cf.DurableObjectStub;
  readonly bucket?: cf.R2Bucket;
  /** Authoritative accepted receipt/retention repair, preserving each original's creator identity. */
  readonly repairAccepted: (
    proof: GenerationRequestProof,
    context: ImageNativeContext,
  ) => Promise<void>;
};

/** Final Models prepare callback. Install alongside registry bridge/readiness; never alone. */
export const createImageGenerationGuard =
  (deps: ImageGenerationDependencies): SkillRequestGuard["prepare"] =>
  async (model, context, signal) => {
    let lease: ImageMemoryLease | undefined;
    let transport: ImageGenerationTransportScope | undefined;
    try {
      const proof = deps.bridge.take(context.messages); // MUST precede any normalization.
      if (proof === null) return { ok: false, message: IMAGE_GENERATION_INCOMPLETE };
      const nativeContext = imageGenerationContext(deps.context, signal);
      if (!(await deps.bridge.verify(proof, nativeContext)))
        return { ok: false, message: IMAGE_GENERATION_INCOMPLETE };
      await verifyImageGenerationState(deps.request, proof, model, nativeContext);
      const compact = await deps.skills.prepareRequestFor(
        proof.operationId,
        model,
        context,
        nativeContext.abortSignal,
      );
      if (!compact.ok) return { ok: false, message: IMAGE_GENERATION_INCOMPLETE };
      let hydrated: HydratedImageRequest;
      if (proof.legacy === true) {
        const catalogModel = await verifyImageGenerationState(
          deps.request,
          proof,
          model,
          nativeContext,
        );
        hydrated = prepareLegacyTextGeneration({
          proof,
          original: context,
          compact: compact.context,
          model: catalogModel,
          signal: nativeContext.abortSignal,
        });
      } else {
        const canonical = canonicalImageGenerationContext(compact.context);
        const projectedProof = remapImageGenerationProof(proof, context, canonical);
        if (proof.inputs.some((input) => input.originals.length > 0))
          await deps.repairAccepted(proof, nativeContext);
        const catalogModel = await verifyImageGenerationState(
          deps.request,
          proof,
          model,
          nativeContext,
        );
        hydrated = await hydrateImageRequest({
          proof: projectedProof,
          context: canonical,
          model: catalogModel,
          ...(deps.catalog === undefined ? {} : { catalog: deps.catalog }),
          ...(deps.bucket === undefined ? {} : { bucket: deps.bucket }),
          signal: nativeContext.abortSignal,
        });
      }
      lease = hydrated.lease;
      await verifyImageGenerationState(deps.request, proof, model, nativeContext);
      const admitted = deps.transport.open(lease, nativeContext.abortSignal);
      transport = admitted;
      if (admitted.signal.aborted) throw new Error(IMAGE_GENERATION_INCOMPLETE);
      return {
        ok: true,
        context: hydrated.context,
        transportSignal: admitted.signal,
        cleanup: () => admitted.close(),
      };
    } catch {
      transport?.close();
      lease?.releaseWhenSettled();
      return { ok: false, message: IMAGE_GENERATION_INCOMPLETE };
    }
  };
