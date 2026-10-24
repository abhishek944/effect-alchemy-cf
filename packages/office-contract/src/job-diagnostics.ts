import { Schema } from "effect";
import { DIAGNOSTIC_TYPES, DIAGNOSTIC_CODES, DIAGNOSTIC_FRAME_PATTERN } from "@starter/diagnostics";
import { Id, decodeWireSync } from "./primitives.ts";

// Job stderr is untrusted. Project finite fields only; never relay arbitrary foreign text.
const Code = Schema.Literals(DIAGNOSTIC_CODES);
const Reason = Schema.Literals([
  "input-read-failed",
  "module-load-failed",
  "decode-failed",
  "execution-failed",
  "result-write-failed",
  "native-import-failed",
  "native-export-failed",
]);
const Phase = Schema.Literals([
  "input",
  "module",
  "decode",
  "import",
  "export",
  "runtime",
  "execute",
  "inspect",
  "render",
  "cleanup",
  "result",
  "output",
]);
const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Timestamp = Schema.String.check(
  Schema.isPattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/),
  Schema.makeFilter((value) => {
    const date = new Date(value);
    return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
  }),
);
const fields = {
  timestamp: Timestamp,
  service: Schema.optionalKey(Schema.Literal("office")),
  stage: Schema.optionalKey(Schema.Literals(["dev_local", "dev", "prod"])),
  release: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  level: Schema.Literals(["ERROR", "INFO"]),
  event: Schema.Literals(["application.failure", "application.phase", "application.complete"]),
  phase: Schema.optionalKey(Phase),
  reason: Schema.optionalKey(Reason),
  outcome: Schema.optionalKey(Schema.Literals(["confirmed", "failed", "unknown"])),
  bytes: Schema.optionalKey(Count),
  duration_ms: Schema.optionalKey(Count),
  causes: Schema.Array(
    Schema.Struct({
      type: Schema.Literals([...DIAGNOSTIC_TYPES, "Unclassified"]),
      code: Schema.optionalKey(Code),
      kind: Schema.optionalKey(Code),
      provider: Schema.optionalKey(
        Schema.Literals(["cloudflare", "resend", "slack", "dodo", "polar"]),
      ),
      reason: Schema.optionalKey(Reason),
      retry_after_seconds: Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 86400 })),
      ),
      status: Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
      ),
      frames: Schema.optionalKey(
        Schema.Array(Schema.String.check(Schema.isPattern(DIAGNOSTIC_FRAME_PATTERN))).check(
          Schema.isMaxLength(3),
        ),
      ),
    }),
  ).check(Schema.isMaxLength(12)),
  causes_truncated: Schema.optionalKey(Schema.Boolean),
};
const Bound = Schema.Struct({
  ...fields,
  component: Schema.Literal("office.job"),
  operation: Schema.Literal("execute"),
  operation_id: Id,
  task_id: Id,
});
// Predecode/import faults cannot trust IDs in the unread input. Only this fixed entry shape
// may receive the physical supervisor's binding; bound records must match both IDs exactly.
const Entry = Schema.Struct({
  ...fields,
  component: Schema.Literal("office.job-entry"),
  operation: Schema.Literal("run"),
  phase: Schema.Literals(["input", "module", "decode", "output"]),
});
type Binding = { operationId: string; taskId: string };
type Record = (typeof Bound.Type | typeof Entry.Type) & { operation_id: string; task_id: string };

function decoder(expected: Binding) {
  let pending: number[] = [],
    bytes = 0,
    failures = 0,
    phases = 0;
  let oversize = false,
    discarded = false;
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  function line(): Record | undefined {
    try {
      if (oversize) throw new Error("Diagnostic line limit");
      const text = utf8.decode(new Uint8Array(pending));
      if (!text.trim()) return undefined;
      const value = decodeWireSync(Schema.Union([Bound, Entry]))(JSON.parse(text));
      const failed = value.event === "application.failure";
      if ((failed && value.level !== "ERROR") || (!failed && value.level !== "INFO"))
        throw new Error("Diagnostic level mismatch");
      if (!failed && (value.phase === undefined || value.causes.length !== 0))
        throw new Error("Invalid lifecycle record");
      if (
        "operation_id" in value &&
        (value.operation_id !== expected.operationId || value.task_id !== expected.taskId)
      )
        throw new Error("Diagnostic association mismatch");
      // Preserve the original four-failure cap; finite lifecycle evidence has its own budget.
      if (failed ? ++failures > 4 : ++phases > 16) throw new Error("Diagnostic record limit");
      return { ...value, operation_id: expected.operationId, task_id: expected.taskId };
    } catch {
      discarded = true;
      return undefined;
    } finally {
      pending = [];
      oversize = false;
    }
  }
  return {
    write(chunk: Uint8Array): Record[] {
      const records: Record[] = [];
      for (const byte of chunk) {
        if (++bytes > 64 * 1024) {
          discarded = true;
          break;
        }
        if (byte === 10) {
          const record = line();
          if (record !== undefined) records.push(record);
        } else if (pending.length < 8192) pending.push(byte);
        else oversize = true;
      }
      return records;
    },
    finish() {
      // Incomplete records (including valid JSON without newline) are never evidence.
      if (pending.length > 0 || oversize) discarded = true;
      pending = [];
      return { discarded };
    },
  };
}

/** Incremental complete-line decoder; transport owners relay each returned batch immediately. */
export function jobDiagnostics(text: undefined, expected: Binding): ReturnType<typeof decoder>;
export function jobDiagnostics(
  text: string,
  expected: Binding,
): { records: Record[]; discarded: boolean };
export function jobDiagnostics(text: string | undefined, expected: Binding) {
  const relay = decoder(expected);
  if (text === undefined) return relay;
  const records = relay.write(new TextEncoder().encode(text));
  return { records, ...relay.finish() };
}
