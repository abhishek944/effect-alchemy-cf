import { boundedID, metadata, NativeStorageError, revision } from "./types.ts";
import type { NativeResources, NativeScope } from "./types.ts";

export interface NativeAuthority {
  readonly epoch: number;
  readonly commandID: string | null;
  readonly stepID: string | null;
}
export async function compareNativeAuthority(
  resources: NativeResources,
  scope: NativeScope,
  expected: NativeAuthority | null,
  next: NativeAuthority,
): Promise<boolean> {
  Object.values(scope).forEach(boundedID);
  revision(next.epoch);
  if (next.commandID !== null) boundedID(next.commandID);
  if (next.stepID !== null) boundedID(next.stepID);
  if (
    next.epoch < 1 ||
    (next.commandID === null) !== (next.stepID === null) ||
    (expected && next.epoch < expected.epoch)
  ) {
    throw new NativeStorageError("FENCE", "Invalid native authority transition");
  }
  const key = metadata([scope.stage, scope.ownerID, scope.documentID, scope.unitID]);
  const statement = expected
    ? resources.database
        .prepare(`UPDATE office_native_authority SET epoch=?,command_id=?,step_id=?
        WHERE scope=? AND epoch=? AND command_id IS ? AND step_id IS ?`)
        .bind(
          next.epoch,
          next.commandID,
          next.stepID,
          key,
          expected.epoch,
          expected.commandID,
          expected.stepID,
        )
    : resources.database
        .prepare("INSERT OR IGNORE INTO office_native_authority VALUES(?,?,?,?)")
        .bind(key, next.epoch, next.commandID, next.stepID);
  return (await statement.run()).meta.changes === 1;
}
