import { Effect } from "effect";
import { createNativeStorage } from "@starter/office-cloudflare/native";
import { decodeWireSync } from "@starter/office-contract";
import { HostUnitRecord } from "@starter/office-server/native-remote";
import { officeNativeContext, officeDenied } from "./office-private-authority.ts";
import type { OfficeHostActive, OfficeHostEntry } from "./office-host-state.ts";

/** Actual admitted readonly SDK adapter metadata, not a fabricated Unit from title/type/constructor. */
export async function officeHostUnit(
  active: OfficeHostActive,
  entry: OfficeHostEntry,
  incoming: Request,
) {
  const view = entry.resolution.view;
  if (view === null) return null;
  await entry.frame.request.live();
  const target = view.target;
  const draft =
    target.scope.kind === "draft"
      ? await Effect.runPromise(active.metadata.draft(target.owner, target.scope.draftId))
      : null;
  if (
    target.scope.kind === "draft" &&
    (draft === null || draft.generation !== target.scope.generation)
  )
    throw officeDenied();
  const storage = createNativeStorage(active.options, {
    stage: target.owner.stage,
    ownerID: target.owner.ownerId,
    documentID: target.documentId,
    unitID: target.unitId,
  });
  const pair = await storage.readInvocation({
    epoch: view.authorityEpoch,
    ...(draft === null
      ? {}
      : { draft: { worktreeID: draft.worktreeId, generation: draft.generation } }),
  });
  try {
    const unit = await pair.database.getUnit(
      officeNativeContext(entry.frame.request, incoming),
      target.unitId,
    );
    await entry.frame.request.live();
    if (unit === null) throw officeDenied();
    return decodeWireSync(HostUnitRecord)(unit);
  } finally {
    await pair.dispose();
  }
}
