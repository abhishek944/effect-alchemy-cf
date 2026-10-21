import { Effect } from "effect";
import {
  createCoordinatorControl,
  createNativeReceiptObserver,
} from "@starter/office-cloudflare/coordinator-control";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { NativeTarget, NativeWriteRecord, OfficeMetadata } from "@starter/office-server/ports";
import type { HostControl } from "@starter/office-server/native-remote";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { officePrivateDigest } from "./office-private-placement.ts";

type ReceiptInput = typeof HostControl.observeReceipt.request.Type.input;
/** Existing immutable journal/slot observation ONLY. No placement claim, turn, content or replay grant. */
export async function officePrivateReceipt(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  nodeId: string,
  input: ReceiptInput,
) {
  await request.live();
  const actor = request.original.actor;
  if (actor.capability !== "human" || !officeSame(input.target.owner, actor.owner))
    throw officeDenied();
  const operation = await Effect.runPromise(metadata.operation(actor.owner, input.operationId));
  if (operation === null) return { state: "unknown" as const };
  if (operation.actor.principalId !== actor.principalId) throw officeDenied();
  let cursor: string | null = null;
  let write: NativeWriteRecord | undefined;
  for (let page = 0; page < 8; page++) {
    const writes: Effect.Success<ReturnType<OfficeMetadata["writes"]>> = await Effect.runPromise(
      metadata.writes(actor.owner, input.operationId, cursor),
    );
    write = writes.items.find((item) => item.id === input.writeId);
    cursor = writes.next;
    if (write !== undefined || cursor === null) break;
  }
  if (write === undefined) return { state: "unknown" as const };
  const draftId = operation.receipt.draftId;
  let scope: NativeTarget["scope"] = { kind: "main" };
  if (operation.worktreeId !== null) {
    if (draftId === null || write.generation === null) throw officeDenied();
    scope = { kind: "draft", draftId, generation: write.generation };
  }
  const target: NativeTarget = {
    owner: operation.owner,
    documentId: write.documentId,
    unitId: write.unitId,
    scope,
  };
  if (
    !officeSame(target, input.target) ||
    write.stepId !== input.stepId ||
    write.payload.digest !== input.payloadDigest ||
    !officeSame(write.receiptKey, input.receipt)
  )
    throw officeDenied();
  const document = { owner: target.owner, documentId: target.documentId, unitId: target.unitId };
  const base = {
    document,
    notAfter: request.original.deadline,
    authorizationDigest: await officePrivateDigest([
      "office-receipt",
      1,
      actor,
      write.id,
      write.payload.digest,
    ]),
  };
  const placement = await Effect.runPromise(
    createCoordinatorControl(options, { ...base, kind: "placement", nodeId }).placement(document),
  );
  if (placement === null) return { state: "unknown" as const };
  await request.live();
  const observed = await Effect.runPromise(
    createNativeReceiptObserver(options, {
      ...base,
      kind: "core",
      purpose: "proof",
      target,
      placementId: placement.id,
      binding: {
        kind: "operation",
        operationId: input.operationId,
        intentDigest: operation.intentDigest,
        lineageDigest: operation.lineageDigest,
      },
    })(input),
  );
  await request.live();
  return observed;
}
