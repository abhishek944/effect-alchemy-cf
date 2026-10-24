import type { ImageArgs } from "@abhishek944/pi-image-gen/core";
import { Schema } from "effect";
import { LiveDoc, type ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  requireAcceptedInputAccess,
  resolveAcceptedInput,
  type AcceptedInputContext,
} from "./chat-accepted-input.ts";
import {
  AcceptedEntryId,
  freezeAcceptedInputValue,
  sameAcceptedInputValue,
} from "./chat-accepted-input-values.ts";
import { decodeOption } from "./chat-internal.ts";
import type { ImageBoundInput, ImageResponseCandidate } from "./chat-image-response-schema.ts";
import type { ImageNativeAccess } from "./chat-image-request-types.ts";
import { proveNativeLineage, type NativeProof } from "./chat-native-provenance.ts";
import {
  decodeNativeImageArguments,
  type NativeImageArguments,
} from "./chat-image-native-proof-args.ts";

export type ProvenImageCall = NativeProof & {
  readonly callId: string;
  readonly snapshot: ImageResponseCandidate;
  readonly current: ImageBoundInput;
  readonly args: NativeImageArguments;
};

const ToolInput = Schema.Struct({
  assistant: AcceptedEntryId,
  callId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
});

/** Exact native lineage only; T20/T25 still authorize sources, reserve and consume once. */
export const resolveImageCall = async (
  api: ToolExecutionApi,
  context: AcceptedInputContext,
  args: Readonly<ImageArgs>,
  access: ImageNativeAccess,
): Promise<ProvenImageCall | null> => {
  try {
    requireAcceptedInputAccess(access, context);
    if (api.conversationId !== access.conversationId) return null;
    const supplied = decodeNativeImageArguments(args);
    if (supplied === null) return null;
    // Deliberately no AccountOperation/theme-intent lookup or model-text intent regex.
    const proof = await proveNativeLineage(api, context, {
      storage: access.storage,
      runningTool: true,
      callNames: ["image_generate"],
      liveSlotName: true,
      readToolInput: (raw) => decodeOption(ToolInput, raw),
      inspectArguments: ({ arguments: value }) => {
        const final = decodeNativeImageArguments(value);
        return final !== null && sameAcceptedInputValue(final, supplied) ? final : null;
      },
    });
    if (proof === null || proof.value === null) return null;
    const live = await api.snapshot(LiveDoc, api.conversationId, context);
    const submissionId = live?.run?.inputs[0];
    if (
      submissionId === undefined ||
      String(submissionId) !== proof.submissionId ||
      live?.run?.inputs.length !== 1
    )
      return null;
    const current = await resolveAcceptedInput(access, api.conversationId, submissionId, context);
    if (current.candidate.operationId !== proof.operationId) return null;
    requireAcceptedInputAccess(access, context);
    return freezeAcceptedInputValue(
      {
        ...proof,
        callId: api.callId,
        snapshot: current.candidate,
        current,
        args: proof.value,
      },
      true,
    );
  } catch {
    return null;
  }
};
