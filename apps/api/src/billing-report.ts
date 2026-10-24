import { reportFailureEffect } from "@starter/diagnostics";
import type { BillingError } from "@starter/integrations/billing";
import type { Effect } from "effect";

/** Expected rejections stay informational; storage/provider/unknown failures are errors. */
const expected = new Set<BillingError["kind"]>([
  "InvalidInput",
  "Conflict",
  "NotFound",
  "Busy",
  "Signature",
]);

const event = (error: BillingError): "application.denial" | "application.failure" =>
  expected.has(error.kind) ? "application.denial" : "application.failure";

/** Verified bounded association only: finite provider names and derived inbox keys. */
export interface BillingAssociation {
  readonly provider?: string | undefined;
  readonly eventId?: string | undefined;
}

/** Outward billing owners report once with the request annotations, then encode safely. */
export const reportBillingFailureEffect = (
  operation: string,
  error: BillingError,
  association: BillingAssociation = {},
): Effect.Effect<void> =>
  reportFailureEffect(error, {
    component: "billing",
    operation,
    event: event(error),
    ...association,
  });
