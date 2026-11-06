import { Predicate } from "effect";
import { textDecoder } from "@univerjs-pro/collaboration";
import { OfficeInvalid, OfficeLimited, safeFailure } from "@highchat/office-contract";
import { encodeNativeFrame } from "@highchat/office-contract/native-wire";

export function invalid(): never {
  throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
}
export function limited(): never {
  throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
}
export function record(value: unknown): Record<string, unknown> {
  if (!Predicate.isObject(value) || Array.isArray(value)) invalid();
  return value;
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    invalid();
  return value;
}
export function coordinate(key: string, bound: number): number {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) invalid();
  return integer(Number(key), 0, bound - 1);
}
/** Validate JSON and native value semantics, without an aggregate load budget. */
export function sheetLoadJson(bytes: Uint8Array | string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(typeof bytes === "string" ? bytes : textDecoder.decode(bytes));
    encodeNativeFrame("job-input", value);
  } catch {
    invalid();
  }
  return record(value);
}
export type SheetDimensions = { readonly rows: number; readonly columns: number };
