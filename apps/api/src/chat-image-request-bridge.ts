import type { Message } from "@earendil-works/pi-ai";
import {
  defineExtension,
  GenerationTask,
  hook,
  type ContextView,
} from "@earendil-works/pi-durable";
import type {
  GenerationRequestTicketProof,
  ImageNativeContext,
  ImageRequestAccess,
  ImageRequestBridge,
  ImageRequestTicket,
} from "./chat-image-request-types.ts";
import {
  imageDiagnosticFailed,
  imageDiagnosticRefused,
  type ImageDiagnosticCorrelation,
  type ImageDiagnosticPhase,
} from "./chat-image-diagnostics.ts";
import { requireImageAccess } from "./chat-image-request-accepted.ts";
import { mapImageInputOccurrences } from "./chat-image-request-occurrences.ts";
import { readImageRequestState } from "./chat-image-request-state.ts";
import { verifyLegacyRequestView } from "./chat-image-request-legacy.ts";
import {
  freezeImageRequestValue,
  imageProofFailure,
  sameImageRequestValue,
} from "./chat-image-request-values.ts";

export type {
  GenerationRequestProof,
  GenerationRequestTicketProof,
  LegacyGenerationRequestProof,
  InputOccurrence,
  ImageNativeContext,
  ImageNativeAccess,
  ImageRequestAccess,
  ImageRequestBridge,
} from "./chat-image-request-types.ts";

/**
 * Install together with the mandatory Models gate. Hook exceptions are swallowed
 * by native 1.1.0; only take + verify can authorize the final request boundary.
 */
export const createImageRequestBridge = (access: ImageRequestAccess): ImageRequestBridge => {
  const tickets = new WeakMap<Message, ImageRequestTicket>();
  const taken = new WeakMap<GenerationRequestTicketProof, readonly Message[]>();
  const proveView = async (
    state: Awaited<ReturnType<typeof readImageRequestState>>,
    view: ContextView,
    context: ImageNativeContext,
  ): Promise<GenerationRequestTicketProof> => {
    if (state.legacy)
      return freezeImageRequestValue(
        { ...state, inputs: await verifyLegacyRequestView(access, view, context) },
        true,
      );
    return freezeImageRequestValue(
      {
        ...state,
        inputs: await mapImageInputOccurrences(access, state.conversationId, view, context),
      },
      true,
    );
  };
  const extension = defineExtension({
    name: "chat-image-request-proof",
    hooks: [
      hook(GenerationTask, {
        async beforeRequest(request, api, context) {
          let phase: ImageDiagnosticPhase = "state";
          let correlation: ImageDiagnosticCorrelation | undefined;
          try {
            const state = await readImageRequestState(
              access,
              api.taskId,
              api.conversationId,
              context,
            );
            correlation = state;
            phase = "context";
            const conversation = await access
              .rawHarness()
              .conversation(api.conversationId, context);
            if (conversation === undefined) return imageProofFailure();
            const view = await conversation.context(context, { at: state.cutoff });
            phase = "view_comparison";
            if (!sameImageRequestValue(request.messages, view.messages)) imageProofFailure();
            phase = "input_mapping";
            const proof = await proveView(state, view, context);
            // Spread arrays preserve these unique wrappers in native generation.js.
            const messages = request.messages.map((message) => ({ ...message }));
            freezeImageRequestValue(messages);
            const ticket: ImageRequestTicket = { messages, proof };
            for (const message of messages) tickets.set(message, ticket);
            phase = "state";
            requireImageAccess(access, context);
            return { messages };
          } catch (error) {
            imageDiagnosticFailed("hook", phase, error, correlation);
            return imageProofFailure();
          }
        },
      }),
    ],
  });

  /** BEFORE any normalization; dropped/reordered/replaced wrappers consume no authority. */
  const take = (messages: readonly Message[]): GenerationRequestTicketProof | null => {
    const first = messages[0];
    const ticket = first === undefined ? undefined : tickets.get(first);
    if (ticket === undefined) return null;
    const valid =
      messages.length === ticket.messages.length &&
      messages.every(
        (message, index) => message === ticket.messages[index] && tickets.get(message) === ticket,
      );
    for (const message of ticket.messages) tickets.delete(message);
    if (!valid) return null;
    taken.set(ticket.proof, ticket.messages);
    return ticket.proof;
  };

  /**
   * Single-use async final revalidation, immediately before hydration/contact.
   * Parent must also check Models' supplied model and AbortSignal against proof.
   */
  const verify = async (
    proof: GenerationRequestTicketProof,
    context: ImageNativeContext,
  ): Promise<boolean> => {
    let phase: ImageDiagnosticPhase = "proof_take";
    const messages = taken.get(proof);
    if (messages === undefined) {
      imageDiagnosticRefused("verify", phase, proof);
      return false;
    }
    taken.delete(proof);
    try {
      phase = "state";
      const state = await readImageRequestState(
        access,
        proof.taskId,
        proof.conversationId,
        context,
      );
      phase = "context";
      const conversation = await access.rawHarness().conversation(proof.conversationId, context);
      if (conversation === undefined) {
        imageDiagnosticRefused("verify", phase, proof);
        return false;
      }
      const view = await conversation.context(context, { at: state.cutoff });
      phase = "view_comparison";
      if (!sameImageRequestValue(messages, view.messages)) {
        imageDiagnosticRefused("verify", phase, proof);
        return false;
      }
      phase = "input_mapping";
      const current = await proveView(state, view, context);
      phase = "view_comparison";
      if (!sameImageRequestValue(proof, current)) {
        imageDiagnosticRefused("verify", phase, proof);
        return false;
      }
      // Context reads/hash awaits must not turn a concurrent Stop into permission.
      phase = "state";
      const final = await readImageRequestState(
        access,
        proof.taskId,
        proof.conversationId,
        context,
      );
      requireImageAccess(access, context);
      const settled = sameImageRequestValue(state, final);
      if (!settled) imageDiagnosticRefused("verify", phase, proof);
      return settled;
    } catch (error) {
      imageDiagnosticFailed("verify", phase, error, proof);
      return false;
    }
  };

  return { extension, take, verify };
};
