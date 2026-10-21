import type { ImageArgs } from "@abhishek944/pi-image-gen/core";
import { Schema } from "effect";
import { DomainUuid } from "./chat-capabilities.ts";
import {
  CALL_EVIDENCE_BYTES,
  CallDigest,
  CallIdentity,
  CallIndex,
  CallPositive,
  CallUrl,
  callJson,
  callFitsJson,
  ImageCallError,
  callParse,
  callValue,
} from "./chat-image-call-values.ts";

export const NativeImageCallArgs = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32_000)),
  image: Schema.optionalKey(
    Schema.mutable(Schema.Array(CallUrl).check(Schema.isMinLength(1), Schema.isMaxLength(16))),
  ),
  size: Schema.optionalKey(Schema.Literals(["auto", "1024x1024", "1024x1536", "1536x1024"])),
  quality: Schema.optionalKey(Schema.Literals(["auto", "low", "medium", "high", "xhigh", "max"])),
});
const Effective = Schema.Struct({
  ...NativeImageCallArgs.fields,
  background: Schema.optionalKey(Schema.Literals(["auto", "transparent", "opaque"])),
  outputFormat: Schema.optionalKey(Schema.Literals(["png", "jpeg", "webp"])),
});
const Control = Schema.Literals([
  "prompt",
  "image",
  "size",
  "quality",
  "background",
  "outputFormat",
]);
const Canonical = Schema.Struct({
  route: Schema.Struct({
    kind: Schema.Literal("catalog"),
    model: Schema.Literals(["openai/gpt-image-2.5-flare", "openai/gpt-image-2.5-sunburst"]),
    gatewayId: CallIdentity.check(Schema.isTrimmed(), Schema.isMaxLength(128)),
  }),
  effective: Schema.Array(Schema.Tuple([Control, Schema.Json])),
  supplied: Schema.Array(Schema.Tuple([Control, Schema.Json])),
  controlSources: Schema.Array(
    Schema.Tuple([Control, Schema.Literals(["explicit", "response-default"])]),
  ),
  references: Schema.Array(Schema.Struct({ role: Schema.Literal("image"), url: CallUrl })),
});
function ordered(entries: readonly (readonly [string, unknown])[]): boolean {
  return entries.every(([key], index) => index === 0 || (entries[index - 1]?.[0] ?? "") < key);
}
export function readImageCallCanonical(input: { canonicalRequest: string }) {
  const raw = callParse(input.canonicalRequest, CALL_EVIDENCE_BYTES);
  if (JSON.stringify(raw) !== input.canonicalRequest) throw new ImageCallError("invalid_input");
  return callValue(Canonical, raw);
}

const identity = (value: unknown): string => callJson(value, CALL_EVIDENCE_BYTES);
function matchesCanonical(input: {
  canonicalRequest: string;
  args: typeof NativeImageCallArgs.Type;
}): boolean {
  try {
    const canonical = readImageCallCanonical(input);
    if (![canonical.effective, canonical.supplied, canonical.controlSources].every(ordered))
      return false;
    const effective = callValue(Effective, Object.fromEntries(canonical.effective));
    const supplied = callValue(NativeImageCallArgs, Object.fromEntries(canonical.supplied));
    if (identity(supplied) !== identity(input.args)) return false;
    if (canonical.controlSources.length !== canonical.effective.length) return false;
    const sources = new Map(canonical.controlSources);
    for (const [key, value] of canonical.effective) {
      const explicit = canonical.supplied.find(([name]) => name === key);
      if (sources.get(key) !== (explicit ? "explicit" : "response-default")) return false;
      if (explicit && identity(value) !== identity(explicit[1])) return false;
    }
    if (canonical.supplied.some(([key]) => !canonical.effective.some(([name]) => name === key)))
      return false;
    return (
      identity(canonical.references) ===
      identity((effective.image ?? []).map((url) => ({ role: "image", url })))
    );
  } catch {
    return false;
  }
}
export const ImageCallAdmission = Schema.Struct({
  key: CallDigest,
  operationId: DomainUuid,
  logicalOperationId: DomainUuid,
  assistantEntryId: CallPositive,
  modelIndex: CallIndex,
  callPosition: CallIndex,
  toolTaskId: CallIdentity,
  nativeCallId: CallIdentity,
  requestDigest: CallDigest,
  canonicalRequest: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(CALL_EVIDENCE_BYTES),
  ),
  args: NativeImageCallArgs,
}).check(
  Schema.makeFilter((input) => callFitsJson(input, CALL_EVIDENCE_BYTES)),
  Schema.makeFilter(matchesCanonical),
);
export type ImageCallAdmission = Omit<typeof ImageCallAdmission.Type, "args"> & {
  readonly args: Readonly<ImageArgs>;
};
