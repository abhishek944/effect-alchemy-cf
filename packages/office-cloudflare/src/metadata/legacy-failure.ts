/** Read-only compatibility for retired Office retry hints in saved metadata, not wire commands. */
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const stripFailure = (value: unknown): void => {
  if (!record(value)) return;
  if (
    typeof value.retry === "string" &&
    ["never", "same-operation", "observe"].includes(value.retry)
  )
    delete value.retry;
};

/** Only known historical fields are dropped; the normal strict schema validates everything else. */
export function readLegacyFailureMetadata(value: unknown): unknown {
  if (!record(value)) return value;
  if (record(value.receipt)) {
    const hint = value.receipt.retryAfterMs;
    if (hint === null || (typeof hint === "number" && Number.isSafeInteger(hint) && hint >= 0))
      delete value.receipt.retryAfterMs;
    stripFailure(value.receipt.error);
  }
  if (record(value.state)) stripFailure(value.state.error);
  return value;
}

/** Compare the same normalized record read above, without rewriting rows or weakening other CAS fields. */
export const operationRecordSql =
  "json_remove(record,'$.receipt.retryAfterMs','$.receipt.error.retry')";
export const jobRecordSql = "json_remove(record,'$.state.error.retry')";
