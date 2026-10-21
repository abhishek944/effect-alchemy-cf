import type { IncomingMessage } from "node:http";
import type { Actor } from "@starter/office-server/ports";
import type { OfficeRequestChannels } from "./native-request-context.ts";

type OfficeIngress = {
  readonly channels: OfficeRequestChannels;
  readonly invocationId: string;
  readonly deadline: number;
  readonly signal: AbortSignal;
};
/** Data returned ONLY by the genuine T47 private process/request issuer. No body/claims/header decoder. */
export type OfficeNodeIngress = OfficeIngress &
  (
    | { readonly kind: "core"; readonly actor: Actor }
    | { readonly kind: "protocol"; readonly viewId: string }
  );
export type ResolveOfficeIngress = (
  request: IncomingMessage,
  signal: AbortSignal,
) => Promise<OfficeNodeIngress>;
