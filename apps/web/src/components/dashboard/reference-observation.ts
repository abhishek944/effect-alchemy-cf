import type { ReferenceObservation, ReferenceSource } from "./reference-types";
import { observationLabel } from "./reference-admission";

/** Freeze capture DTOs before any save/checkpoint callback can await or retain them. */
export function freezeReferenceObservation(
  observation: ReferenceObservation,
  source?: ReferenceSource,
): ReferenceObservation {
  const copy = structuredClone(observation);
  const display = source
    ? {
        label: observationLabel(source, copy),
        fileKind: source.kind === "native" ? source.target.documentKind : source.file.kind,
      }
    : copy.display;
  if (copy.kind === "native") {
    const context =
      copy.capture.context.kind === "sheet-range"
        ? Object.freeze({
            ...copy.capture.context,
            ranges: Object.freeze(
              copy.capture.context.ranges.map((range) => Object.freeze({ ...range })),
            ),
          })
        : Object.freeze({ ...copy.capture.context });
    return Object.freeze({
      ...copy,
      ...(display ? { display: Object.freeze(display) } : {}),
      capture: Object.freeze({ ...copy.capture, context }),
    });
  }
  return Object.freeze({
    ...copy,
    ...(display ? { display: Object.freeze(display) } : {}),
    capture: Object.freeze({ ...copy.capture }),
  });
}
