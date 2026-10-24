import { Schema } from "effect";
import type { EntryId } from "@earendil-works/pi-durable";

export const AcceptedEntryId = Schema.declare<EntryId>(
  (value): value is EntryId =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  { title: "AcceptedEntryId" },
);
export const AcceptedIndex = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
);

/** Structural work bounds, not capability/reference count limits or a heap guarantee. */
const MAX_NODES = 262_144;
const MAX_DEPTH = 64;
export const MAX_ACCEPTED_INPUT_PROOF_CHARACTERS = 1_048_576;

export const acceptedInputFailure = (): never => {
  throw new Error("Accepted input provenance could not be verified.");
};

/** Positional JSON comparison; never serialize a second full context/base64 body. */
export const sameAcceptedInputValue = (left: unknown, right: unknown): boolean => {
  let remaining = MAX_NODES;
  const equal = (a: unknown, b: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > MAX_DEPTH) return false;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object")
      return Object.is(a, b);
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((value, index) => equal(value, b[index], depth + 1));
    }
    for (const key of keys) {
      if (!Object.hasOwn(b, key) || !equal(Reflect.get(a, key), Reflect.get(b, key), depth + 1))
        return false;
    }
    return true;
  };
  return equal(left, right, 0);
};

/** Freeze without copying strings. Proofs have an additional aggregate metadata bound. */
export const freezeAcceptedInputValue = <T>(value: T, proof = false): T => {
  let remaining = MAX_NODES;
  let characters = 0;
  const visited = new WeakSet<object>();
  const freeze = (part: unknown, depth: number): void => {
    if (--remaining < 0 || depth > MAX_DEPTH) acceptedInputFailure();
    if (typeof part === "string") {
      characters += part.length;
      if (proof && characters > MAX_ACCEPTED_INPUT_PROOF_CHARACTERS) acceptedInputFailure();
    }
    if (part === null || typeof part !== "object") return;
    if (visited.has(part)) return;
    visited.add(part);
    for (const child of Object.values(part)) freeze(child, depth + 1);
    Object.freeze(part);
  };
  freeze(value, 0);
  return value;
};
