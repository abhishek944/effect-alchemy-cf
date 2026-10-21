import { Predicate } from "effect";
import { textDecoder } from "@univerjs-pro/collaboration";
import { OfficeInvalid, OfficeLimited, safeFailure } from "@starter/office-contract";
import {
  NativeWireError,
  NATIVE_WIRE_LIMITS,
  encodeNativeFrame,
} from "@starter/office-contract/native-wire";

/** Admission counts actual eager SDK axes/cache entries, not encoded wire size or elapsed time. */
export const SHEET_LOAD_BUDGET = Object.freeze({
  sheets: 128,
  rows: 4_194_304,
  columns: 131_072,
  merges: 16_384,
  mergeCells: 262_144,
  mergeRows: 131_072,
  mergeAxis: 262_144,
  sparse: 250_000,
  styles: 16_384,
  blocks: 4096,
  mutations: 5000,
  metadataBytes: 8 * 1024 * 1024,
  jsonBytes: 48 * 1024 * 1024,
});
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
export function createSheetLoadBudget() {
  const used = new Map<keyof typeof SHEET_LOAD_BUDGET, number>();
  const charge = (key: keyof typeof SHEET_LOAD_BUDGET, amount: number) => {
    integer(amount);
    const previous = used.get(key) ?? 0;
    if (amount > SHEET_LOAD_BUDGET[key] - previous) limited();
    used.set(key, previous + amount);
  };
  const product = (key: keyof typeof SHEET_LOAD_BUDGET, a: number, b: number) => {
    integer(a);
    integer(b);
    const remaining = SHEET_LOAD_BUDGET[key] - (used.get(key) ?? 0);
    if (b !== 0 && a > Math.floor(remaining / b)) limited();
    charge(key, a * b); // Proven <= remaining before multiplication.
  };
  const json = (bytes: Uint8Array | string, metadata = false): Record<string, unknown> => {
    if (bytes.length > 2 * 1024 * 1024) limited();
    const size =
      typeof bytes === "string" ? new TextEncoder().encode(bytes).byteLength : bytes.byteLength;
    if (size > 2 * 1024 * 1024) limited();
    charge("jsonBytes", size);
    if (metadata) charge("metadataBytes", size);
    let value: unknown;
    try {
      value = JSON.parse(typeof bytes === "string" ? bytes : textDecoder.decode(bytes));
      encodeNativeFrame("job-input", value, {
        ...NATIVE_WIRE_LIMITS,
        maxBytes: 2 * 1024 * 1024,
        maxDepth: 32,
        maxNodes: 100_000,
      });
    } catch (error) {
      if (error instanceof NativeWireError && error.code === "LIMIT_EXCEEDED") limited();
      invalid();
    }
    return record(value);
  };
  return { charge, product, json };
}
export type SheetLoadBudget = ReturnType<typeof createSheetLoadBudget>;
export type SheetDimensions = { readonly rows: number; readonly columns: number };
