import { NativeDatabase } from "./database.ts";
import { captureNativeAdmission } from "./admission-fence.ts";
import { NativeStorageError } from "./types.ts";
import { compareNativeAuthority } from "./authority.ts";
import type { NativeAuthority } from "./authority.ts";
import { createNativeDatabaseAdapter } from "./core.ts";
import { NativeCoreReferences } from "./core-refs.ts";
import { NativeWorktreeReferences } from "./worktree-refs.ts";
import { createNativeWorktreeDatabaseAdapter } from "./worktree.ts";
import { NativePayloads } from "./payloads.ts";
import { NativeReferenceReads } from "./reference-reads.ts";
import type {
  NativeFence,
  NativeReadAccess,
  NativeResources,
  NativeScope,
  NativeStorageHooks,
  StrictNativeStorageHooks,
} from "./types.ts";
import { createReadonlyNativeInvocation, createNativeReferenceReader } from "./readonly.ts";
export type { NativeReadInvocation, NativeReadReferences } from "./readonly.ts";

export { initializeNativeSchema, nativeSchemaStatements, nativeSchemaVersion } from "./schema.ts";
export { decodeNativePayload, encodeNativePayload } from "./codec.ts";
export { nativeLimits, NativeStorageError } from "./types.ts";
export type {
  NativeScope,
  NativeFence,
  NativeReadAccess,
  NativeReadOrigin,
  NativeResources,
  NativePieceRef,
  NativeValueRef,
  NativeSnapshotRefs,
  NativeChangesetRef,
  NativePayloadKind,
  NativeProducerVerifier,
  NativeStorageHooks,
  NativePublicationBinding,
  NativePublicationPreparation,
  NativePreparedWrite,
} from "./types.ts";
export type { NativeValueHeader } from "./value-headers.ts";
export type { NativeAuthority } from "./authority.ts";
export type { NativeStepReceipt, NativeStepReceiptPage } from "./step-receipts.ts";
export type { NativeCommitRefResult } from "./core-refs.ts";
export type { NativeDraftCommitRefResult, NativeMergeArtifactRefResult } from "./worktree-refs.ts";

/** Trusted composition only. Neither scope nor fence may come from native request/customData. */
export function createNativeStorage(
  resources: NativeResources,
  scope: NativeScope,
  hooks?: NativeStorageHooks,
) {
  const captured = Object.freeze({ ...scope });
  const admission = hooks?.admission ? captureNativeAdmission(hooks.admission) : undefined;
  if (
    admission &&
    (typeof hooks?.verifyProducer !== "function" || typeof hooks.beforePublication !== "function")
  )
    throw new NativeStorageError("SCOPE", "Strict native writer requires producer and preparation");
  const verifiedProducer = hooks?.verifyProducer
    ? Object.freeze({ verifyProducer: hooks.verifyProducer.bind(hooks) })
    : undefined;
  const prepare = hooks?.beforePublication?.bind(hooks);
  return {
    compareAuthority(expected: NativeAuthority | null, next: NativeAuthority): Promise<boolean> {
      return compareNativeAuthority(resources, captured, expected, next);
    },
    readReferences(access: NativeReadAccess) {
      return createNativeReferenceReader(resources, captured, access);
    },
    readInvocation(access: NativeReadAccess) {
      return createReadonlyNativeInvocation(resources, captured, access);
    },
    invocation(fence: NativeFence) {
      const db = new NativeDatabase(resources, captured, fence, prepare, admission);
      const payloads = new NativePayloads(db, verifiedProducer);
      const core = new NativeCoreReferences(db, payloads);
      const worktree = new NativeWorktreeReferences(db, payloads);
      return {
        database: createNativeDatabaseAdapter(db, payloads, core),
        worktrees: createNativeWorktreeDatabaseAdapter(db, payloads, worktree),
        references: { core, worktree, payloads, reads: new NativeReferenceReads(db, payloads) },
        dispose: async (): Promise<void> => {
          db.dispose();
        },
      };
    },
  };
}
/** Production writer entry. T47 authenticates before construction; an admission identity is not a credential. */
export function createStrictNativeStorage(
  resources: NativeResources,
  scope: NativeScope,
  hooks: StrictNativeStorageHooks,
) {
  if (
    !hooks?.admission ||
    typeof hooks.verifyProducer !== "function" ||
    typeof hooks.beforePublication !== "function"
  )
    throw new NativeStorageError(
      "SCOPE",
      "Strict writer requires admission, producer and preparation",
    );
  const admission = captureNativeAdmission(hooks.admission);
  const native = createNativeStorage(resources, scope, {
    admission,
    verifyProducer: hooks.verifyProducer.bind(hooks),
    beforePublication: hooks.beforePublication.bind(hooks),
  });
  // Do not expose historical readers or authority mutation as an omission-selected fallback.
  return Object.freeze({ invocation: (fence: NativeFence) => native.invocation(fence) });
}
export type NativeStorage = ReturnType<typeof createNativeStorage>;
export type NativeInvocation = ReturnType<NativeStorage["invocation"]>;
