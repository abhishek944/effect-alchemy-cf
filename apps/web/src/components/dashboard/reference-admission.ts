import { freezeChatReferenceInputs } from "@highchat/chat-contract";
import type { ReferenceObservation, ReferenceSource, ReferenceValue } from "./reference-types";

export function observationLabel(
  source: ReferenceSource,
  observation: ReferenceObservation,
): string {
  return `${source.name} · ${observation.capture.label}`;
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
