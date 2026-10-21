import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { Effect, Scope } from "effect";
import type { OfficeError } from "@starter/office-contract";

/** Actual17-owned handlers. No auth/default provider, generic RPC or SDK serializer lives in listener15. */
export type OfficeNodeHandlers = {
  readonly request: (
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly upgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly revoke: () => void;
  /** Includes actual SDK/message/connection-close/foreign cleanup promises, not just current-map emptiness. */
  readonly drain: () => Promise<void>;
};
export type OfficeNodeServerOptions = {
  readonly host: string;
  readonly port: number;
  readonly maxConnections: number;
  readonly maxRequests: number;
  readonly maxHeaderBytes: number;
  readonly maxHeadersCount: number;
  readonly headersTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly handlers: OfficeNodeHandlers;
};
export type OfficeNodeServer = {
  readonly address: Readonly<AddressInfo>;
  readonly signal: AbortSignal;
  readonly close: () => Promise<void>;
};
export type MakeOfficeNodeServer = (
  options: OfficeNodeServerOptions,
) => Effect.Effect<OfficeNodeServer, OfficeError, Scope.Scope>;
