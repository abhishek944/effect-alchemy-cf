import type { ReferenceObservation, ReferenceSource } from "./reference-types";
import { observationLabel } from "./reference-admission";

/** Freeze capture DTOs before any save/checkpoint callback can await or retain them. */
export function freezeReferenceObservation(
  observation: ReferenceObservation,
  source?: ReferenceSource,
): ReferenceObservation {
  const copy = structuredClone(observation);
  const display = source
    ? { label: observationLabel(source, copy), fileKind: source.file.kind }
    : copy.display;
  return Object.freeze({
    ...copy,
    ...(display ? { display: Object.freeze(display) } : {}),
    capture: Object.freeze({ ...copy.capture }),
  });
}
