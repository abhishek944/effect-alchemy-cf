import type { Effect } from "effect";
import type { OfficeError } from "@starter/office-contract";
import type { OfficeRemoteMethod } from "./native-channel.ts";

export type OfficeBinaryInput = {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly requestBytes: number;
  readonly responseLimit: number;
  readonly mutation: boolean;
};
/**
 * Finite schema header + original opaque bytes, NEVER native document JSON/base64.
 * A successful exchange joins the actual upload EOF/cancellation before returning.
 * The returned body retains its real lease until EOF/cancel or channel.close().
 */
export interface OfficeBinarySession {
  exchange<Q, A>(
    definition: OfficeRemoteMethod<Q, A>,
    input: Q,
    transfer: OfficeBinaryInput,
  ): Effect.Effect<
    {
      readonly value: A;
      readonly body: ReadableStream<Uint8Array>;
    },
    OfficeError
  >;
  /** Joins actual pending IO, not merely interrupted Effect wrappers. */
  drain(): Promise<void>;
}
export interface OfficeBinaryChannel extends OfficeBinarySession {
  /** Revoke first, cancel/join actual IO; failure/pending never certifies quiescence. */
  close(): Promise<void>;
}
