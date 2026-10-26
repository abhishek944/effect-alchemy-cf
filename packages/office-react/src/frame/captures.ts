import { CommandType } from "@univerjs/core";
import { Schema } from "effect";
import {
  freezeNativeCapture,
  NativeSelectionCaptureSchema,
  type NativeSelectionCapture,
} from "../capture.ts";
import type { NativeApplication } from "./native.ts";
import type { FrameInit } from "./messages.ts";
import { observeCompletedSelection } from "./selection-observer.ts";
import { captureFailure, readSelectionScope, validateScope } from "./selection-scope.ts";
import { revealSelection } from "./selection-reveal.ts";
import { nativeFailure } from "./lifecycle.ts";

const mutationSource = Schema.decodeUnknownSync(
  Schema.Struct({ unitId: Schema.optionalKey(Schema.String) }),
);
/** Own frame-local capture provenance, SDK subscriptions, epoch invalidation and reveal cancellation. */
export function nativeCaptures(
  native: NativeApplication,
  input: FrameInit,
  container: HTMLElement,
  publish: (capture: NativeSelectionCapture) => void,
) {
  const unitId = input.view.nativeTarget.unitId;
  let epoch = 0;
  let disposed = false;
  let reveal: AbortController | null = null;
  // Observation identities live only in this frame. Old epochs are discarded immediately;
  // bounded retention refuses expired captures explicitly rather than retargeting them.
  const issued = new Map<string, NativeSelectionCapture>();
  const mutationRevision = () =>
    input.view.kind === "doc"
      ? native.univerAPI.getDocument(unitId)?.getDocumentDataModel().getMutationRevision()
      : undefined;
  let lastMutation = mutationRevision();
  const invalidate = () => {
    epoch++;
    issued.clear();
    reveal?.abort();
  };
  const currentEpoch = () => {
    const next = mutationRevision();
    if (next !== lastMutation) {
      lastMutation = next;
      invalidate();
    }
    return epoch;
  };
  const mutations = native.univerAPI.addEvent(
    native.univerAPI.Event.BeforeCommandExecute,
    (event) => {
      if (event.type !== CommandType.MUTATION || event.cancel) return;
      let source: { readonly unitId?: string };
      try {
        source = mutationSource(event.params);
      } catch {
        source = {};
      }
      // Include remote/fromChangeset mutations; unknown unit provenance is conservatively invalid.
      if (source.unitId === undefined || source.unitId === unitId) invalidate();
    },
  );
  const observer = observeCompletedSelection(native, unitId, input.view.kind, () => {
    if (disposed || !native.activity.idle()) return;
    try {
      const contentEpoch = currentEpoch();
      const context = readSelectionScope(native, unitId, input.view.kind);
      if (context === null) return; // Caret/unsupported scope never clears the host's retained tray.
      const capture = freezeNativeCapture({
        captureId: crypto.randomUUID(),
        viewId: input.view.id,
        unitId,
        contentEpoch,
        context,
      });
      issued.set(capture.captureId, capture);
      const oldest = issued.keys().next().value;
      if (issued.size > 64 && oldest !== undefined) issued.delete(oldest);
      publish(capture);
    } catch {
      // Unsupported SDK selections are not observations and never widen to whole context.
    }
  });
  const validate = (raw: unknown) => {
    const capture = freezeNativeCapture(raw);
    if (observer.composing())
      throw nativeFailure(
        "input",
        "composing",
        "Finish composing native text before adding a reference.",
      );
    if (disposed || observer.busy() || !native.activity.idle())
      throw captureFailure("capture-unavailable");
    if (
      capture.viewId !== input.view.id ||
      capture.unitId !== unitId ||
      capture.contentEpoch !== currentEpoch()
    )
      throw captureFailure("capture-changed");
    const original = issued.get(capture.captureId);
    if (!original || !Schema.toEquivalence(NativeSelectionCaptureSchema)(capture, original))
      throw captureFailure("capture-unavailable");
    validateScope(native, unitId, capture.context);
  };
  return {
    unitId,
    validate,
    async reveal(raw: unknown) {
      const capture = freezeNativeCapture(raw);
      validate(capture);
      const generation = observer.generation();
      const controller = new AbortController();
      reveal = controller;
      observer.suppress(true);
      try {
        await revealSelection(native, container, unitId, capture.context, controller.signal, () => {
          validate(capture);
          if (controller.signal.aborted || observer.generation() !== generation)
            throw captureFailure("capture-unavailable");
        });
      } finally {
        controller.abort();
        reveal = null;
        observer.suppress(false);
      }
    },
    dispose() {
      disposed = true;
      reveal?.abort();
      issued.clear();
      mutations.dispose();
      observer.dispose();
    },
  };
}
