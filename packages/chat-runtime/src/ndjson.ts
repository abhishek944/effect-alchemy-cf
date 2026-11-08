import type { Schema } from "effect";
import { decodeWireSync } from "@highchat/chat-contract";

/**
 * Newline-delimited JSON framing shared by both sides. Framing stays pure so the
 * Worker and the host use the same encoder without importing platform builtins.
 */
export const encodeNdjsonLine = (value: unknown): string => `${JSON.stringify(value)}\n`;

/** Split a complete NDJSON body into its non-empty records, still unparsed. */
export const ndjsonRecords = (body: string): string[] => {
  const records: string[] = [];
  for (const line of body.split(/\r\n|\r|\n/)) {
    const record = line.trim();
    if (record.length > 0) records.push(record);
  }
  return records;
};

const parseRecord = (record: string): unknown => {
  const value: unknown = JSON.parse(record);
  return value;
};

/** Decode each record of a complete NDJSON body with the strict wire policy. */
export const decodeNdjson = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  body: string,
) => {
  const decode = decodeWireSync(schema);
  return ndjsonRecords(body).map((record) => decode(parseRecord(record)));
};

export const encodeNdjson = (values: Iterable<unknown>): string => {
  let body = "";
  for (const value of values) body += encodeNdjsonLine(value);
  return body;
};

/**
 * Stream NDJSON records out of a byte stream, one parsed value at a time.
 *
 * A `TextDecoder` in streaming mode carries partial UTF-8 sequences across chunks,
 * CRLF, CR and LF all end a record, blank lines are skipped, and a final
 * unterminated record is still emitted. No size or count limit is imposed: the
 * caller decides when to stop. Stopping early, or an error anywhere, cancels and
 * releases the reader so the underlying source is never left locked.
 */
export async function* ndjsonLines(stream: ReadableStream<unknown>): AsyncIterable<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) pending += decoder.decode();
      else {
        const bytes = chunk.value;
        if (!(bytes instanceof Uint8Array)) throw new Error("Expected an NDJSON byte stream");
        pending += decoder.decode(bytes, { stream: true });
      }
      const lines = pending.split(/\r\n|\r|\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const record = line.trim();
        if (record.length > 0) yield parseRecord(record);
      }
      if (chunk.done) {
        completed = true;
        break;
      }
    }
    const rest = pending.trim();
    if (rest.length > 0) yield parseRecord(rest);
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
