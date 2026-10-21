import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { NativeValueHeader } from "./value-headers.ts";
import type { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import type { ISnapshot, IChangeset } from "@univerjs/protocol";
import type { WorktreeStatus } from "@univerjs-pro/collaboration-worktree-service";

export interface NativeScope {
  readonly stage: string;
  readonly ownerID: string;
  readonly documentID: string;
  readonly unitID: string;
}
export interface NativeReadAccess {
  readonly epoch: number;
  readonly draft?: { readonly worktreeID: string; readonly generation: number };
}
export type NativeReadOrigin =
  | { readonly kind: "snapshot"; readonly revision: number }
  | { readonly kind: "seed"; readonly worktreeID: string }
  | { readonly kind: "merge-artifact"; readonly worktreeID: string; readonly readyRevision: number }
  | { readonly kind: "changeset"; readonly branch: string; readonly revision: number };
export interface NativeFence {
  readonly epoch: number;
  readonly commandID: string;
  readonly stepID: string;
  readonly main: { readonly head: number; readonly lifecycle: "active" | "soft" | "hard" } | null;
  readonly draft?: {
    readonly worktreeID: string;
    readonly generation: number;
    readonly status: WorktreeStatus;
    readonly head: number;
    readonly removed: boolean;
  };
}
export type NativePayloadKind = "snapshot" | "block" | "changeset";
export interface NativePieceRef {
  readonly key: string;
  readonly digest: string;
  readonly bytes: number;
}
export interface NativeValueRef {
  readonly codec: typeof NATIVE_WIRE_CODEC;
  readonly kind: NativePayloadKind;
  readonly bytes: number;
  readonly parts: readonly NativePieceRef[];
}
export interface NativeSnapshotRefs {
  readonly unitID: string;
  readonly type: ISnapshot["type"];
  readonly revision: number;
  readonly snapshot: NativeValueRef;
  readonly blocks: readonly { readonly blockID: string; readonly value: NativeValueRef }[];
}
export interface NativeChangesetRef {
  readonly unitID: string;
  readonly type: IChangeset["type"];
  readonly baseRev: number;
  readonly revision: number;
  readonly sid?: string | undefined;
  readonly reqId?: number | undefined;
  readonly value: NativeValueRef;
}
/** Trusted owning SDK producer only: verify its represented protocol envelope and exact encoded manifest/header.
 * SDK-omitted/extension payload fields stay intact; finite ref/record DTO rules remain separately strict.
 * Authentication/composition belongs to the host; there is deliberately no permissive implementation here.
 */
export interface NativeProducerVerifier {
  readonly verifyProducer: (
    value: NativeValueRef,
    header: NativeValueHeader,
    fence: NativeFence,
  ) => Promise<void>;
}
export interface NativePublicationBinding {
  readonly action: string;
  readonly fingerprint: string;
  readonly authorityEpoch: number;
}
export interface NativePreparedWrite {
  readonly writeId: string;
  readonly payloadDigest: string;
}
export type NativePublicationPreparation = (
  binding: NativePublicationBinding,
  fence: NativeFence,
) => Promise<NativePreparedWrite>;
/** Captured by strict trusted composition, never selected by a remote request flag. */
export interface NativeAdmission {
  readonly turnId: string;
  readonly fence: number;
  readonly authorizationDigest: string;
  readonly notAfter: number;
}
export interface NativeStorageHooks {
  readonly verifyProducer?: NativeProducerVerifier["verifyProducer"];
  readonly beforePublication?: NativePublicationPreparation;
  readonly admission?: NativeAdmission;
}
export interface StrictNativeStorageHooks {
  readonly verifyProducer: NativeProducerVerifier["verifyProducer"];
  readonly beforePublication: NativePublicationPreparation;
  readonly admission: NativeAdmission;
}
export interface NativeResources {
  readonly database: D1Database;
  readonly bucket: R2Bucket;
}
export class NativeStorageError extends Error {
  readonly code:
    | "SCOPE"
    | "FENCE"
    | "CONFLICT"
    | "CONTENT"
    | "LIMIT"
    | "VERSION"
    | "DISPOSED"
    | "READ_ONLY";
  constructor(code: NativeStorageError["code"], message: string) {
    super(message);
    this.name = "NativeStorageError";
    this.code = code;
  }
}
export const nativeLimits = Object.freeze({
  pieceBytes: 4 * 1024 * 1024,
  aggregateBytes: 128 * 1024 * 1024,
  parts: 32,
  blocks: 4096,
  metadataBytes: 16 * 1024,
  manifestBytes: 2 * 1024 * 1024,
  blockBytes: 8 * 1024 * 1024,
  historyPage: 128,
});
export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("");
}
export function boundedID(value: string): string {
  if (!value || new TextEncoder().encode(value).length > 256) {
    throw new NativeStorageError("LIMIT", "Native identity must contain 1..256 bytes");
  }
  return value;
}
export { metadata } from "./metadata.ts";
export function revision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NativeStorageError("CONTENT", "Invalid native revision");
  }
  return value;
}
