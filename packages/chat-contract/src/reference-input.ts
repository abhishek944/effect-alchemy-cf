import { Schema } from "effect";
import { Count, Id, decodeWireSync } from "./primitives.ts";

const Span = { start: Count, end: Count };
const ordered = (span: { readonly start: number; readonly end: number }) => span.start < span.end;
const TextSpan = Schema.Struct(Span).check(Schema.makeFilter(ordered));
const FileId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);

/** Occurrence identity and inclusive/exclusive caption span, not a label-derived authority. */
export const ChatReferenceInput = Schema.Struct({
  id: Id,
  ...Span,
  kind: Schema.Literal("original"),
  fileId: FileId,
  text: Schema.optionalKey(TextSpan),
}).check(Schema.makeFilter(ordered));
export type ChatReferenceInput = typeof ChatReferenceInput.Type;

export const ChatReferenceInputs = Schema.Array(ChatReferenceInput).check(
  Schema.makeFilter((inputs) => {
    if (new Set(inputs.map((input) => input.id)).size !== inputs.length) return false;
    const spans = inputs.toSorted((a, b) => a.start - b.start);
    return spans.every((span, index) => (spans[index - 1]?.end ?? 0) <= span.start);
  }),
);
export type ChatReferenceInputs = typeof ChatReferenceInputs.Type;

/** Decode with excess-key rejection, clone, and recursively freeze before the first await. */
export const freezeChatReferenceInputs = (input: ChatReferenceInputs): ChatReferenceInputs =>
  Object.freeze(
    decodeWireSync(ChatReferenceInputs)(input).map((entry) =>
      Object.freeze({
        ...entry,
        ...(entry.text === undefined ? {} : { text: Object.freeze({ ...entry.text }) }),
      }),
    ),
  );

/** Append only for nonempty inputs: absence/empty must retain historical Send identity bytes. */
export const chatReferenceInputsIdentity = (inputs: ChatReferenceInputs): readonly unknown[] => [
  "message-references",
  1,
  inputs.map((entry) => [
    entry.id,
    entry.start,
    entry.end,
    entry.kind,
    entry.fileId,
    entry.text === undefined ? null : [entry.text.start, entry.text.end],
  ]),
];
