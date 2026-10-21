import type { Effect, Scope } from "effect";
import type { IDatabaseAdapter } from "@univerjs-pro/collaboration-service";
import type { IWorktreeDatabaseAdapter } from "@univerjs-pro/collaboration-worktree-service";
import type { OfficeError } from "@starter/office-contract";
import type { NativeTarget, WritePermit } from "./identity.ts";
import type { NativeEditorPermit } from "./native-editor.ts";

/** Upstream SDK ports, acquired for one real document/read or admitted write invocation. */
export type NativeAdapters = {
  readonly core: IDatabaseAdapter;
  readonly worktrees: IWorktreeDatabaseAdapter;
};
export type NativeAccess =
  | {
      readonly kind: "read";
      readonly target: NativeTarget;
      readonly authorityEpoch: number;
      readonly serviceEpoch: number;
    }
  | { readonly kind: "write"; readonly permit: WritePermit }
  | { readonly kind: "editor"; readonly permit: NativeEditorPermit };
/**
 * Resolve actual target/epochs and acquire fresh invocation-local adapters.
 * Reads deny all native mutations; never invent command IDs/fences to obtain readers.
 * Writes derive scope only from the admitted permit.target and real native state.
 * Register invocation.dispose() with Scope; no mutable database/reference handle escapes.
 *
 * Private document-bound Node SDK dispatch may resolve this acquired pair from an
 * active async-local lease. Nested Worktree -> trunk calls reuse that same pair/turn;
 * they do not acquire another authority.serial. Revoke the lease before disposal.
 * Reject detached work or callbacks after the lease closes. D1 fencing remains final.
 * Metadata-only discovery/staging does not need a native acquisition.
 */
export type OpenNative = (
  access: NativeAccess,
) => Effect.Effect<NativeAdapters, OfficeError, Scope.Scope>;
