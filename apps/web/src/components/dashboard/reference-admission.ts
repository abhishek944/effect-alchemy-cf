import { freezeChatReferenceInputs, freezeOfficeSendTarget } from "@starter/office-contract";
import type { ReferenceObservation, ReferenceSource, ReferenceValue } from "./reference-types";

const column = (value: number): string => {
  let label = "";
  for (let next = value + 1; next > 0; next = Math.floor((next - 1) / 26))
    label = String.fromCharCode(65 + ((next - 1) % 26)) + label;
  return label;
};
export function observationLabel(
  source: ReferenceSource,
  observation: ReferenceObservation,
): string {
  if (observation.kind === "original") return `${source.name} · ${observation.capture.label}`;
  const context = observation.capture.context;
  if (context.kind === "doc-text") return `${source.name} · “${context.text.replace(/\r/g, "\n")}”`;
  const ranges = context.ranges.map(
    (range) =>
      range.a1 ??
      `${column(range.startColumn)}${range.startRow + 1}:${column(range.endColumn)}${range.endRow + 1}`,
  );
  return `${source.name} · ${context.sheetName ?? context.sheetId}!${ranges.join(", ")}`;
}

/** No label parsing or observed-context promotion. The parent supplies actual checkpoint authority. */
export async function prepareReference(
  source: ReferenceSource,
  observation: ReferenceObservation | null,
): Promise<ReferenceValue> {
  if (
    observation &&
    (observation.chatId !== source.chatId ||
      observation.sourceKey !== source.key ||
      observation.kind !== source.kind)
  )
    throw new Error("This selection no longer belongs to the requested source.");
  const label = observation ? observationLabel(source, observation) : source.name;
  const span = { id: crypto.randomUUID(), start: 0, end: label.length };
  if (source.kind === "original") {
    if (source.file.chatId !== source.chatId || source.file.state !== "ready")
      throw new Error("The saved original is unavailable.");
    const capture = observation?.kind === "original" ? observation.capture : null;
    const input = freezeChatReferenceInputs([
      {
        ...span,
        kind: "original",
        fileId: source.file.id,
        ...(capture ? { text: { start: capture.start, end: capture.end } } : {}),
      },
    ])[0];
    if (!input) throw new Error("Reference admission returned no source.");
    return Object.freeze({ label, input, file: Object.freeze(structuredClone(source.file)) });
  }
  const capture = observation?.kind === "native" ? observation.capture : null;
  const target = await source.prepare(capture);
  if (
    target.documentId !== source.target.documentId ||
    target.documentKind !== source.target.documentKind ||
    target.kind !== source.target.kind ||
    (target.kind === "draft" &&
      (source.target.kind !== "draft" ||
        target.draftId !== source.target.draftId ||
        target.generation !== source.target.generation))
  )
    throw new Error("The checkpoint belongs to a different native source. Reselect it.");
  // Legacy active-panel observations must never be promoted into an explicit reference.
  const { context: _observed, ...identity } = target;
  const input = freezeChatReferenceInputs([
    {
      ...span,
      kind: "native",
      target: freezeOfficeSendTarget(identity),
      context: capture?.context ?? { kind: "whole" },
    },
  ])[0];
  if (!input) throw new Error("Reference admission returned no source.");
  return Object.freeze({ label, input });
}
