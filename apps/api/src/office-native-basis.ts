import { Effect } from "effect";
import { createNativeStorage } from "@starter/office-cloudflare/native";
import type { NativeFence, NativeScope } from "@starter/office-cloudflare/native";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { OfficeMetadata } from "@starter/office-server/ports";
import type { OfficeHeldTurn } from "./office-private-turns.ts";
import type { OfficeEditorHeld } from "./office-editor-grants.ts";
import {
  officeDenied,
  officeNativeContext,
  type OfficePrivateRequest,
} from "./office-private-authority.ts";

/** Worker metadata preflight, not another Node SDK pair or native admission. Each real readonly
 * facade is closed before the single strict writer is created. Core must see ADVANCED main.
 */
export async function officeNativeBasis(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  held: OfficeHeldTurn | OfficeEditorHeld,
  request: OfficePrivateRequest,
): Promise<NativeFence> {
  const { target } = held.permit;
  const scope: NativeScope = {
    stage: target.owner.stage,
    ownerID: target.owner.ownerId,
    documentID: target.documentId,
    unitID: target.unitId,
  };
  const native = createNativeStorage(options, scope);
  const context = officeNativeContext(request, held.permit);
  const main = await native.readInvocation({ epoch: held.permit.authorityEpoch });
  let unit: Awaited<ReturnType<typeof main.database.getUnit>>;
  try {
    unit = await main.database.getUnit(context, scope.unitID);
  } finally {
    await main.dispose();
  }
  const fence: NativeFence = {
    epoch: held.permit.authorityEpoch,
    commandID: held.kind === "core" ? held.permit.operationId : held.permit.submissionId,
    stepID: held.permit.stepId,
    main: unit === null ? null : { head: unit.headRevision, lifecycle: "active" },
  };
  if (target.scope.kind === "main") {
    if (held.kind === "editor" && unit?.headRevision !== held.permit.expectedHead)
      throw officeDenied();
    return fence;
  }
  const draft = await Effect.runPromise(metadata.draft(target.owner, target.scope.draftId));
  if (draft === null || draft.generation !== target.scope.generation) throw officeDenied();
  // The FIRST actual Core admission's SQL basis attests absence for THIS birth. "fresh" ALONE
  // does not: ordinary existing-document execution has the same plan with a nonnull head.
  const birth =
    held.kind === "core" && held.turn.nativePlan === "fresh" && held.permit.expectedHead === null;
  if (birth)
    return {
      ...fence,
      draft: {
        worktreeID: draft.worktreeId,
        generation: draft.generation,
        status: "draft",
        head: 0,
        removed: false,
      },
    };
  const branch = await native.readInvocation({
    epoch: held.permit.authorityEpoch,
    draft: { worktreeID: draft.worktreeId, generation: draft.generation },
  });
  try {
    const aggregate = await branch.worktrees.getWorktree(context, draft.worktreeId);
    if (aggregate === null) throw officeDenied();
    const actual = aggregate.units.find((item) => item.unitID === scope.unitID);
    const newborn =
      held.kind === "core" &&
      held.turn.nativePlan === "newborn-unit" &&
      held.permit.expectedHead === null;
    if (actual === undefined && !newborn) throw officeDenied();
    if (held.kind === "editor" && actual?.draftHeadRevision !== held.permit.expectedHead)
      throw officeDenied();
    return {
      ...fence,
      draft: {
        worktreeID: draft.worktreeId,
        generation: draft.generation,
        status: aggregate.worktree.status,
        head: actual?.draftHeadRevision ?? 0,
        removed: actual?.removed ?? false,
      },
    };
  } finally {
    await branch.dispose();
  }
}
