import { Effect } from "effect";
import { createNativeWritePreparation } from "@starter/office-cloudflare/coordinator-control";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { NativePublicationPreparation } from "@starter/office-cloudflare/native";
import type {
  NativeReceiptKey,
  OfficeMetadata,
  NativeWriteRecord,
} from "@starter/office-server/ports";
import type { OfficeHeldTurn } from "./office-private-turns.ts";
import { officeDenied, type OfficePrivateRequest } from "./office-private-authority.ts";

/** Exact provider semantic keys only, never an action supplied by Node or a generic receipt search. */
function action(key: NativeReceiptKey): string {
  switch (key.kind) {
    case "create-main":
      return "create-main";
    case "snapshot":
      return `snapshot:${key.revision}`;
    case "main-change":
      return `main-change:${key.revision}`;
    case "create-worktree":
      return `create-worktree:${key.worktreeId}`;
    case "add-unit":
      return `add-unit:${key.worktreeId}`;
    case "create-draft":
      return `create-draft:${key.worktreeId}`;
    case "merge-artifact":
      return `artifact:${key.worktreeId}:${key.readyRevision}`;
    case "merge-result":
      return `merge-result:${key.worktreeId}:${key.readyRevision}`;
    case "draft-change":
      return `draft-change:${key.worktreeId}:${key.revision}`;
    case "transition":
      return `transition:${key.worktreeId}:${key.generation}:${key.target}`;
    case "set-removed":
      return `removed:${key.worktreeId}:${key.generation}:${Number(key.removed)}`;
  }
  throw officeDenied();
}
export function officeNativePreparation(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  held: OfficeHeldTurn,
  request: OfficePrivateRequest,
): NativePublicationPreparation {
  const { turn, permit, context } = held;
  const admission: Parameters<typeof createNativeWritePreparation>[2] = {
    turnId: turn.id,
    fence: turn.fence,
    authorizationDigest: turn.authorizationDigest,
    notAfter: turn.authNotAfter,
  };
  const prepare = createNativeWritePreparation(options, context, admission);
  return async (binding, fence) => {
    await request.live();
    if (
      fence.commandID !== turn.commandId ||
      fence.stepID !== turn.stepId ||
      fence.epoch !== turn.authorityEpoch ||
      binding.authorityEpoch !== permit.authorityEpoch
    )
      throw officeDenied();
    let cursor: string | null = null;
    let selected: NativeWriteRecord | undefined;
    for (let page = 0; page < 8; page++) {
      const writes: Effect.Success<ReturnType<OfficeMetadata["writes"]>> = await Effect.runPromise(
        metadata.writes(permit.owner, permit.operationId, cursor),
      );
      for (const write of writes.items) {
        if (write.stepId === permit.stepId && action(write.receiptKey) === binding.action) {
          if (selected !== undefined) throw officeDenied();
          selected = write;
        }
      }
      cursor = writes.next;
      if (cursor === null) break;
    }
    if (
      cursor !== null ||
      selected === undefined ||
      selected.documentId !== permit.documentId ||
      selected.unitId !== permit.target.unitId ||
      selected.phase !== "staged"
    )
      throw officeDenied();
    // Fingerprint comes from this REAL provider publication, not Node/schema/receipt echo.
    const prepared = await Effect.runPromise(
      prepare(permit, selected.id, {
        fingerprint: binding.fingerprint,
        authorityEpoch: binding.authorityEpoch,
      }),
    );
    await request.live();
    return { writeId: prepared.id, payloadDigest: prepared.payload.digest };
  };
}
