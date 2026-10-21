import type { NativeReadAccess, NativeResources, NativeFence, NativeScope } from "./types.ts";
import { boundedID, revision, NativeStorageError } from "./types.ts";
export function validateNativeAccess(
  scope: NativeScope,
  access: NativeReadAccess | NativeFence,
): void {
  Object.values(scope).forEach(boundedID);
  revision(access.epoch);
  if (access.epoch < 1)
    throw new NativeStorageError("FENCE", "A real positive native epoch is required");
  if ("commandID" in access) {
    boundedID(access.commandID);
    boundedID(access.stepID);
  }
}

export async function assertReadEpoch(
  resources: NativeResources,
  key: string,
  access: NativeReadAccess,
): Promise<void> {
  const draft = access.draft;
  const row = await resources.database
    .withSession("first-primary")
    .prepare(
      `SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=?${
        draft
          ? " AND EXISTS(SELECT 1 FROM office_native_worktrees WHERE scope=? AND id=? AND generation=?)"
          : ""
      }`,
    )
    .bind(key, access.epoch, ...(draft ? [key, draft.worktreeID, draft.generation] : []))
    .first();
  if (!row)
    throw new NativeStorageError("FENCE", "Native read epoch, generation or lifecycle is stale");
}
