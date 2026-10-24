import type * as cf from "@cloudflare/workers-types";
import type { Context } from "@earendil-works/pi-ai";
import type {
  ImageGenerationTransport,
  ImageGenerationTransportScope,
} from "./chat-image-binding.ts";
import {
  imageDiagnosticFailed,
  imageDiagnosticRefused,
  type ImageDiagnosticPhase,
} from "./chat-image-diagnostics.ts";
import { hydrateImageRequest } from "./chat-image-hydration.ts";
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
  GenerationRequestTicketProof,
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
    let transport: ImageGenerationTransportScope | undefined;
    let phase: ImageDiagnosticPhase = "proof_take";
    let proof: GenerationRequestTicketProof | null = null;
    try {
      proof = deps.bridge.take(context.messages); // MUST precede any normalization.
      if (proof === null) {
        imageDiagnosticRefused("prepare", phase);
        return { ok: false, message: IMAGE_GENERATION_INCOMPLETE };
      }
      phase = "context";
      const nativeContext = imageGenerationContext(deps.context, signal);
      phase = "bridge_verify";
      if (!(await deps.bridge.verify(proof, nativeContext))) {
        imageDiagnosticRefused("prepare", phase, proof);
        return { ok: false, message: IMAGE_GENERATION_INCOMPLETE };
      }
      phase = "state";
      await verifyImageGenerationState(deps.request, proof, model, nativeContext);
      phase = "skill_preparation";
      const compact = await deps.skills.prepareRequestFor(
        proof.operationId,
        model,
        context,
        nativeContext.abortSignal,
      );
      if (!compact.ok) {
        imageDiagnosticRefused("prepare", phase, proof);
        return { ok: false, message: IMAGE_GENERATION_INCOMPLETE };
      }
      let hydrated: Context;
      if (proof.legacy === true) {
        phase = "state";
        const catalogModel = await verifyImageGenerationState(
          deps.request,
          proof,
          model,
          nativeContext,
        );
        phase = "legacy_preparation";
        hydrated = prepareLegacyTextGeneration({
          proof,
          original: context,
          compact: compact.context,
          model: catalogModel,
          signal: nativeContext.abortSignal,
        });
      } else {
        phase = "canonicalization";
        const canonical = canonicalImageGenerationContext(compact.context);
        phase = "remap";
        const projectedProof = remapImageGenerationProof(proof, context, canonical);
        if (proof.inputs.some((input) => input.originals.length > 0)) {
          phase = "acceptance_repair";
          await deps.repairAccepted(proof, nativeContext);
        }
        phase = "state";
        const catalogModel = await verifyImageGenerationState(
          deps.request,
          proof,
          model,
          nativeContext,
        );
        phase = "original_hydration";
        hydrated = await hydrateImageRequest({
          proof: projectedProof,
          context: canonical,
          model: catalogModel,
          ...(deps.catalog === undefined ? {} : { catalog: deps.catalog }),
          ...(deps.bucket === undefined ? {} : { bucket: deps.bucket }),
          signal: nativeContext.abortSignal,
        });
      }
      phase = "final_verification";
      await verifyImageGenerationState(deps.request, proof, model, nativeContext);
      phase = "transport_admission";
      const admitted = deps.transport.open(nativeContext.abortSignal);
      transport = admitted;
      if (admitted.signal.aborted) throw new Error(IMAGE_GENERATION_INCOMPLETE);
      return {
        ok: true,
        context: hydrated,
        transportSignal: admitted.signal,
        cleanup: () => admitted.close(),
      };
    } catch (error) {
      imageDiagnosticFailed("prepare", phase, error, proof ?? undefined);
      transport?.close();
      return { ok: false, message: IMAGE_GENERATION_INCOMPLETE };
    }
  };
