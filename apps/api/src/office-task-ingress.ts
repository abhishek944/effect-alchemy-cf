import type { HostOfficeRequest, HostBytes } from "@starter/office-server/native-remote";
import type { NativePrivateFile } from "../../office/src/native-private-wire.ts";
import type { OfficeInvocation } from "./office-invocations.ts";
import type { OfficePrivateRequest } from "./office-private-authority.ts";
import { officeDenied } from "./office-private-authority.ts";
import {
  assertOfficeTaskCommand,
  assertOfficeTaskUpload,
  assertOfficeTaskReceipt,
} from "./office-task-command.ts";

/** Original actual Root record only. Routes/headers correlate, never authenticate the caller. */
export function assertOfficeTaskRoute(original: OfficeInvocation, mode: string): void {
  if (!("task" in original)) return;
  if (original.task.observeOnly) {
    if (mode !== "core") throw officeDenied();
    return;
  }
  const command = original.task.proof.association.intent.command.command;
  const stage = command === "stage-file" || command === "stage-code";
  if (mode !== (stage ? "upload" : "core")) throw officeDenied();
}
export function assertOfficeTaskBody(
  original: OfficeInvocation,
  command: HostOfficeRequest | null,
  file: NativePrivateFile | null,
): void {
  if (!("task" in original)) return;
  if (original.task.observeOnly) {
    if (file !== null || command === null) throw officeDenied();
    assertOfficeTaskReceipt(original.task.proof, command);
    return;
  }
  if (file !== null) {
    if (command !== null || file.kind !== "upload") throw officeDenied();
    assertOfficeTaskUpload(original.task.proof, file.input);
  } else {
    if (command === null) throw officeDenied();
    assertOfficeTaskCommand(original.task.proof, command);
  }
}

/** Actual bytes still require owning provider count/hash/EOF; expected metadata isn't an ACK. */
export function assertOfficeTaskUploadPut(
  request: OfficePrivateRequest,
  input: (typeof HostBytes.put.request.Type)["input"],
): void {
  const original = request.original;
  if (!("task" in original)) return;
  const file = request.file;
  if (original.task.observeOnly || file?.kind !== "upload") throw officeDenied();
  assertOfficeTaskUpload(original.task.proof, file.input);
  if (
    input.id !== file.input.operationId ||
    input.kind !== file.input.kind ||
    input.declaredBytes !== file.input.bytes ||
    input.expectedDigest !== file.input.digest ||
    input.mediaType !==
      (file.input.kind === "code" ? "text/javascript" : "application/octet-stream")
  )
    throw officeDenied();
}
