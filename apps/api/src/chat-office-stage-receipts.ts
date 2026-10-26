import { Schema } from "effect";
import { defineDocFamily, GenerationTask, LiveDoc, ToolTask } from "@earendil-works/pi-durable";
import { Count, Digest, decodeWireSync, officeImportOptions } from "@starter/office-contract";
import type { ArtifactRef } from "@starter/office-contract";
import type { OfficeResolution } from "@starter/office-pi";
import type { OfficeTaskAssociation } from "./chat-office-task-association.ts";
import { OfficeStageReceipt, OfficeStageReceipts } from "./office-task-proof.ts";
import { freezeAcceptedInputValue, sameAcceptedInputValue } from "./chat-accepted-input-values.ts";
import { officeDenied } from "./office-private-authority.ts";
import { officeTaskFile } from "./office-task-file.ts";

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Binding = Schema.Struct({
  stage: Name,
  ownerId: Name,
  chatScope: Name,
  sessionEpoch: Count,
  requestId: Name,
  submissionId: Name,
  conversationId: Name,
  digest: Digest,
});
const Ledger = Schema.Struct({ binding: Binding, receipts: OfficeStageReceipts });
type Binding = typeof Binding.Type;
type Ledger = { binding: Binding; receipts: OfficeStageReceipt[] };
const Stages = defineDocFamily<Ledger, Binding>({
  family: true,
  kind: "chat.office-stage-receipts",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: (binding) => ({ binding, receipts: [] }),
});
const bindingOf = (a: OfficeTaskAssociation): Binding => ({
  stage: a.session.stage,
  ownerId: a.session.ownerId,
  chatScope: a.chatScope,
  sessionEpoch: a.session.sessionEpoch,
  requestId: a.acceptedInput.requestId,
  submissionId: a.acceptedInput.submissionId,
  conversationId: a.acceptedInput.conversationId,
  digest: a.acceptedInput.digest,
});
const keyOf = (a: OfficeTaskAssociation) =>
  JSON.stringify([
    a.acceptedInput.requestId,
    a.acceptedInput.submissionId,
    a.acceptedInput.conversationId,
    a.acceptedInput.digest,
  ]);

/** Non-creating read after actual native association proof. Never parse a transcript as a receipt. */
export async function readOfficeStageReceipts(
  resolution: OfficeResolution,
  association: OfficeTaskAssociation,
): Promise<readonly OfficeStageReceipt[]> {
  const stored = await resolution.api.snapshot(
    Stages,
    resolution.api.conversationId,
    keyOf(association),
    resolution.context,
  );
  if (stored === undefined) return Object.freeze([]);
  const ledger = decodeWireSync(Ledger)(stored);
  if (!sameAcceptedInputValue(ledger.binding, bindingOf(association))) throw officeDenied();
  return freezeAcceptedInputValue(ledger.receipts, true);
}

/** Caller owns the actual verified provider ACK, exact lease object and fresh native association. */
export async function recordOfficeStageReceipt(
  resolution: OfficeResolution,
  association: OfficeTaskAssociation,
  value: ArtifactRef,
  notAfter: number,
): Promise<void> {
  const command = association.intent.command;
  const artifact = decodeWireSync(OfficeStageReceipt)({
    toolTaskId: String(resolution.api.taskId),
    artifact: value,
    ...(command.command === "stage-file" ? { fileRef: command.input.fileRef } : {}),
  });
  if (
    value.id !== association.intent.operationId ||
    !("input" in command) ||
    !("operationId" in command.input) ||
    command.input.operationId !== value.id
  )
    throw officeDenied();
  if (command.command === "stage-code") {
    if (
      value.kind !== "code" ||
      value.digest !== command.input.digest ||
      value.bytes !== command.input.bytes ||
      value.mediaType !== "text/javascript"
    )
      throw officeDenied();
  } else if (command.command === "stage-file") {
    const file = officeTaskFile(association, command.input.fileRef);
    if (
      !file ||
      !officeImportOptions(file.mediaType, file.name) ||
      value.kind !== "upload" ||
      value.digest !== file.digest ||
      value.bytes !== file.byteSize ||
      value.mediaType !== "application/octet-stream"
    )
      throw officeDenied();
  } else throw officeDenied();
  await resolution.api.commit(async (tx) => {
    if (Date.now() >= notAfter || association.session.expiresAt <= Date.now()) throw officeDenied();
    const task = await tx.task(resolution.api.taskId);
    const generation = task?.owner === undefined ? undefined : await tx.task(task.owner);
    const live = await tx.doc(LiveDoc, resolution.api.conversationId);
    const slot = live?.tools?.find((item) => item.taskId === resolution.api.taskId);
    if (
      task?.kind !== ToolTask.definition.name ||
      task.version !== ToolTask.definition.version ||
      task.state.status !== "running" ||
      task.abortRequested ||
      task.conversationId !== resolution.api.conversationId ||
      String(task.owner) !== association.acceptedInput.generationTaskId ||
      generation?.kind !== GenerationTask.definition.name ||
      generation.version !== GenerationTask.definition.version ||
      generation.state.status !== "waiting" ||
      generation.abortRequested ||
      String(live?.run?.taskId) !== association.acceptedInput.generationTaskId ||
      live?.run?.inputs.length !== 1 ||
      String(live.run.inputs[0]) !== association.acceptedInput.submissionId ||
      slot?.status !== "running" ||
      slot.callId !== resolution.api.callId
    )
      throw officeDenied();
    const expected = bindingOf(association);
    const ledger = await tx.doc(
      Stages,
      resolution.api.conversationId,
      keyOf(association),
      expected,
    );
    const checked = decodeWireSync(Ledger)(ledger);
    if (!sameAcceptedInputValue(checked.binding, expected)) throw officeDenied();
    const old = checked.receipts.find((item) => item.artifact.id === value.id);
    if (old !== undefined) {
      if (
        !sameAcceptedInputValue(old.artifact, artifact.artifact) ||
        old.fileRef !== artifact.fileRef
      )
        throw officeDenied();
      return;
    }
    if (checked.receipts.length >= 32) throw officeDenied();
    if (Date.now() >= notAfter || association.session.expiresAt <= Date.now()) throw officeDenied();
    ledger.receipts.push(structuredClone(artifact));
  }, resolution.context);
}
