import type { Schema } from "effect";
import { decodeWireSync } from "@highchat/chat-contract";
import { HostFailure } from "./errors.ts";

/** Decode untrusted JSON with the shared strict wire policy and a host-level refusal. */
export const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  body: string,
): S["Type"] => {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HostFailure("invalid_request", "body is not JSON");
  }
  try {
    return decodeWireSync(schema)(value);
  } catch {
    throw new HostFailure("invalid_request", "body does not match the wire schema");
  }
};

/** Decode one already-split JSON record, as used by the NDJSON reply channel. */
export const decodeRecord = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  record: string,
  code: "invalid_request" | "invalid_reply",
): S["Type"] => {
  let value: unknown;
  try {
    value = JSON.parse(record);
  } catch {
    throw new HostFailure(code, "record is not JSON");
  }
  try {
    return decodeWireSync(schema)(value);
  } catch {
    throw new HostFailure(code, "record does not match the wire schema");
  }
};
