import type { Effect } from "effect";
import type { OfficeError } from "@starter/office-contract";
import type { NativeTarget, OwnerScope, WritePermit } from "./identity.ts";

/** Requested effects only; the provider independently validates original durable authority. */
export type SerialAdmission = {
  readonly operationId: string;
  readonly expectedHead: number | null;
  readonly reviewFingerprint: string | null;
  readonly purpose: "native" | "metadata" | "proof";
};

/**
 * Stable document DO authority. Implement with final D1 transaction fencing.
 * Execution launch releases its turn; a completed proposal obtains a fresh commit turn.
 * An async handler, process mutex, queue acknowledgement or TTL alone is not a fence.
 */
export interface DocumentAuthority {
  serial<A, E>(
    target: NativeTarget,
    admission: SerialAdmission,
    body: (permit: WritePermit) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | OfficeError>;
  current(
    owner: OwnerScope,
    documentId: string,
  ): Effect.Effect<
    {
      readonly authorityEpoch: number;
      readonly serviceEpoch: number;
    },
    OfficeError
  >;
}
export type RuntimeCacheKey = {
  readonly owner: OwnerScope;
  readonly documentId: string;
  readonly branch: string;
  readonly generation: number;
  readonly revision: number;
  readonly authorityEpoch: number;
  readonly serviceEpoch: number;
  readonly sdkVersion: "1.0.3";
  readonly policyVersion: string;
  readonly imageDigest: string;
};
