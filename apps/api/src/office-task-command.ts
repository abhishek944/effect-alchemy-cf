import { decodeWireSync, officeImportOptions } from "@starter/office-contract";
import type { OfficeIntentCommand } from "@starter/office-pi";
import type { OperationRecord } from "@starter/office-server/ports";
import { HostOfficeRequest } from "@starter/office-server/native-remote";
import type { NativePrivateFile } from "../../office/src/native-private-wire.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import type { OfficeTaskProof } from "./office-task-proof.ts";

function expected(command: OfficeIntentCommand): HostOfficeRequest | null {
  switch (command.command) {
    case "stage-code":
    case "stage-file":
      return null;
    case "list":
    case "drafts":
      return { method: `office.${command.command}`, input: { cursor: command.cursor } };
    case "draft":
      return { method: "office.draft", input: { id: command.draftId } };
    case "review":
      return {
        method: "office.review",
        input: { reviewId: command.reviewId, cursor: command.cursor },
      };
    case "operation":
      return { method: "office.receipt", input: { operationId: command.operationId } };
    default:
      return decodeWireSync(HostOfficeRequest)({
        method: `office.${command.command}`,
        input: command.input,
      });
  }
}

const receiptKinds = new Set([
  "create",
  "create-draft",
  "execute",
  "import-into",
  "render",
  "export",
  "ready",
  "reopen",
  "discard",
]);
/** Finite observe-only selector. Still requires stored same-input/intent policy, never dispatch. */
export function assertOfficeTaskReceipt(proof: OfficeTaskProof, call: HostOfficeRequest): void {
  if (call.method !== "office.receipt") throw officeDenied();
  const command = proof.association.intent.command;
  if (command.command === "operation") {
    if (call.input.operationId !== command.operationId) throw officeDenied();
  } else if (
    !receiptKinds.has(command.command) ||
    !("input" in command) ||
    !("operationId" in command.input) ||
    call.input.operationId !== command.input.operationId ||
    call.input.operationId !== proof.association.intent.operationId
  )
    throw officeDenied();
}

/** Stored original intent must also match fallback; an explicit operation read selects its own ID. */
export function assertOfficeTaskObservedIntent(
  proof: OfficeTaskProof,
  operation: OperationRecord,
): void {
  const command = proof.association.intent.command;
  if (command.command === "operation") return;
  if (
    !receiptKinds.has(command.command) ||
    !("input" in command) ||
    operation.intent.kind !== command.command ||
    !officeSame(operation.intent.input, command.input)
  )
    throw officeDenied();
}

/** Correlates ONLY an already-proven live private callback. It issues no actor/target/native grant. */
export function assertOfficeTaskCommand(proof: OfficeTaskProof, command: HostOfficeRequest): void {
  if (command.method === "office.receipt") return assertOfficeTaskReceipt(proof, command);
  const original = expected(proof.association.intent.command);
  if (original === null || !officeSame(original, command)) throw officeDenied();
}

/** Expected metadata is NOT a byte hash/EOF acknowledgement; actual uploader must still verify. */
export function assertOfficeTaskUpload(
  proof: OfficeTaskProof,
  input: Extract<NativePrivateFile, { readonly kind: "upload" }>["input"],
): void {
  const command = proof.association.intent.command;
  if (command.command === "stage-code") {
    if (
      input.kind !== "code" ||
      input.operationId !== command.input.operationId ||
      input.filename !== "office.js" ||
      input.bytes !== command.input.bytes ||
      input.digest !== command.input.digest
    )
      throw officeDenied();
    return;
  }
  if (command.command !== "stage-file") throw officeDenied();
  const original = proof.association.originals.find(
    (file) => file.fileId === command.input.fileRef,
  );
  if (
    !original ||
    !officeImportOptions(original.mediaType, original.name) ||
    input.kind !== "upload" ||
    input.operationId !== command.input.operationId ||
    input.filename !== original.name ||
    input.bytes !== original.byteSize ||
    input.digest !== original.digest
  )
    throw officeDenied();
}
