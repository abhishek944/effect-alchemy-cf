import { Effect } from "effect";
import { HostControl } from "@starter/office-server/native-remote";
import type { DocumentAuthority, OfficeDependencies } from "@starter/office-server/ports";
import type { OfficeControlCaller } from "./native-channel.ts";

type ControlReads = Pick<OfficeDependencies, "verifyActor" | "observeNativeReceipt"> &
  Pick<DocumentAuthority, "current">;
/** Read/verification ports only; deliberately NOT a fabricated complete DocumentAuthority. */
export function createOfficeControlClient(channel: OfficeControlCaller): ControlReads {
  return Object.freeze({
    verifyActor: (input) => channel.call(HostControl.verifyActor, input, false).pipe(Effect.asVoid),
    observeNativeReceipt: (input) => channel.call(HostControl.observeReceipt, input, false),
    current: (owner, documentId) => channel.call(HostControl.current, { owner, documentId }, false),
  } satisfies ControlReads);
}
