import type { IDatabaseAdapter } from "@univerjs-pro/collaboration-service";
import type { IWorktreeDatabaseAdapter } from "@univerjs-pro/collaboration-worktree-service";
import { NativeDatabase } from "./database.ts";
import { NativePayloads } from "./payloads.ts";
import { NativeCoreReferences } from "./core-refs.ts";
import { NativeWorktreeReferences } from "./worktree-refs.ts";
import { createNativeDatabaseAdapter } from "./core.ts";
import { createNativeWorktreeDatabaseAdapter } from "./worktree.ts";
import { NativeStorageError } from "./types.ts";
import { NativeReferenceReads } from "./reference-reads.ts";
import type { NativePieceRef, NativeReadOrigin } from "./types.ts";
import { loadPublishedPiece } from "./published-reads.ts";
import type { NativeResources, NativeScope, NativeReadAccess } from "./types.ts";

export interface NativeReadInvocation {
  readonly database: IDatabaseAdapter;
  readonly worktrees: IWorktreeDatabaseAdapter;
  readonly dispose: () => Promise<void>;
}
export async function createNativeReferenceReader(
  resources: NativeResources,
  scope: NativeScope,
  access: NativeReadAccess,
) {
  const db = new NativeDatabase(resources, scope, access);
  await db.assertReadable();
  const payloads = new NativePayloads(db);
  const reads = new NativeReferenceReads(db, payloads);
  return {
    reads,
    loadPiece: (origin: NativeReadOrigin, ref: NativePieceRef): Promise<Uint8Array> =>
      loadPublishedPiece(db, payloads, reads, origin, ref),
    dispose: async (): Promise<void> => {
      db.dispose();
    },
  };
}
export type NativeReadReferences = Awaited<ReturnType<typeof createNativeReferenceReader>>;
const denyMutation = async (): Promise<never> => {
  throw new NativeStorageError("READ_ONLY", "Native reader cannot mutate or stage content");
};
/** Real scope/epoch acquisition, without allocating any write command or native step. */
export async function createReadonlyNativeInvocation(
  resources: NativeResources,
  scope: NativeScope,
  access: NativeReadAccess,
): Promise<NativeReadInvocation> {
  const db = new NativeDatabase(resources, scope, access);
  await db.assertReadable();
  const payloads = new NativePayloads(db);
  const database: IDatabaseAdapter = {
    ...createNativeDatabaseAdapter(db, payloads, new NativeCoreReferences(db, payloads)),
    createUnit: denyMutation,
    commitChangeset: denyMutation,
    saveSnapshot: denyMutation,
    deleteUnits: denyMutation,
    recoverUnits: denyMutation,
  };
  const worktrees: IWorktreeDatabaseAdapter = {
    ...createNativeWorktreeDatabaseAdapter(
      db,
      payloads,
      new NativeWorktreeReferences(db, payloads),
    ),
    createWorktree: denyMutation,
    addUnit: denyMutation,
    createUnit: denyMutation,
    saveUnitMergeArtifact: denyMutation,
    setUnitRemoved: denyMutation,
    commitDraftChangeset: denyMutation,
    markReady: denyMutation,
    reopenWorktree: denyMutation,
    discardWorktree: denyMutation,
    startOrResumeMerge: denyMutation,
    recordUnitMergeResult: denyMutation,
    finishMerge: denyMutation,
  };
  return {
    database,
    worktrees,
    dispose: async () => {
      db.dispose();
    },
  };
}
