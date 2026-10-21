import { Effect } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { freezeOfficeSendTarget } from "@starter/office-contract";
import { makeOfficeClient } from "@starter/office-contract/client";
import type { Editor, OfficeChannel, Target, View } from "@starter/office-contract";
import type { OfficeRuntime, OfficeSave } from "@starter/office-react";

/** Browser boundary: existing same-origin human authentication, no provider or server imports. */
export async function createOfficeRuntime(): Promise<OfficeRuntime> {
  const client = await Effect.runPromise(
    makeOfficeClient(location.origin).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.RequestInit, { credentials: "same-origin" }),
    ),
  );
  return { client, run: (effect, options) => Effect.runPromise(effect, options) };
}
export type OpenOffice = { view: View; editor: Editor | null; channel: OfficeChannel };
export function assertOfficeViewTarget(view: View, target: Target): void {
  if (view.documentId !== target.documentId) throw new Error("Office document changed.");
  if (view.nativeTarget.kind === "pinned-snapshot") {
    if (view.mode !== "read-only") throw new Error("Invalid frozen Office view.");
  } else if (target.scope.kind === "draft") {
    if (
      view.nativeTarget.kind !== "draft" ||
      view.nativeTarget.generation !== target.scope.generation
    )
      throw new Error("Office draft generation changed.");
  } else if (view.nativeTarget.kind !== "main") throw new Error("Office branch changed.");
}

/** Freeze the displayed held View, never its latest server head or a new generation. */
export function officeSendAnchor(opened: OpenOffice, saved: OfficeSave | null, target: Target) {
  if (opened.view.nativeTarget.kind === "pinned-snapshot") return null;
  assertOfficeViewTarget(opened.view, target);
  if (saved?.viewId !== opened.view.id || saved.revision !== opened.view.revision)
    throw new Error("Save and reopen this Office tab before Send; its displayed anchor changed.");
  const common = {
    viewId: opened.view.id,
    documentId: opened.view.documentId,
    documentKind: opened.view.kind,
    expectedRevision: saved.revision,
  };
  return freezeOfficeSendTarget(
    target.scope.kind === "main"
      ? { kind: "main", ...common }
      : {
          kind: "draft",
          ...common,
          draftId: target.scope.draftId,
          generation: target.scope.generation,
        },
  );
}

/** Initial explicit open only. A later save/reanchor must also compare the exact held ACK. */
export async function openOffice(
  runtime: OfficeRuntime,
  target: Target,
  signal: AbortSignal,
): Promise<OpenOffice> {
  const options = { signal };
  const first = await runtime.run(runtime.client.office.open({ payload: target }), options);
  signal.throwIfAborted();
  assertOfficeViewTarget(first, target);
  const editor =
    first.mode === "edit"
      ? await runtime.run(
          runtime.client.office.editor({
            payload: { kind: "acquire", target },
          }),
          options,
        )
      : null;
  signal.throwIfAborted();
  const view = editor?.view ?? first;
  assertOfficeViewTarget(view, target);
  if (editor !== null && (editor.state !== "active" || editor.expiresAt <= Date.now()))
    throw new Error("Office editor authority is unavailable.");
  const channel = await runtime.run(
    runtime.client.office.channel({
      payload: { viewId: view.id, editorId: editor?.id ?? null },
    }),
    options,
  );
  signal.throwIfAborted();
  if (channel.expiresAt <= Date.now() || channel.expiresAt > view.expiresAt)
    throw new Error("Office channel expired.");
  return { view, editor, channel };
}

export async function drainOffice(
  runtime: OfficeRuntime,
  opened: OpenOffice,
  saved: OfficeSave,
  signal: AbortSignal,
): Promise<OpenOffice> {
  if (
    opened.editor === null ||
    saved.viewId !== opened.view.id ||
    !Number.isSafeInteger(saved.revision) ||
    saved.revision < opened.view.revision
  )
    throw new Error("Native save acknowledgement is unavailable.");
  const editor = await runtime.run(
    runtime.client.office.editor({
      payload: {
        kind: "drained",
        editorId: opened.editor.id,
        confirmedRevision: saved.revision,
      },
    }),
    { signal },
  );
  if (
    editor.id !== opened.editor.id ||
    editor.epoch !== opened.editor.epoch ||
    editor.state !== "drained"
  )
    throw new Error("Editor drain is unconfirmed.");
  return { ...opened, editor };
}

export async function reacquireOffice(
  runtime: OfficeRuntime,
  target: Target,
  saved: OfficeSave | null,
  signal: AbortSignal,
): Promise<OpenOffice> {
  const fresh = await openOffice(runtime, target, signal);
  if (saved !== null && fresh.view.revision !== saved.revision) {
    if (fresh.editor !== null) {
      // This new editor has never been mounted or admitted any user input.
      const revoked = await runtime.run(
        runtime.client.office.editor({
          payload: {
            kind: "revoke",
            editorId: fresh.editor.id,
            discardUnconfirmed: true,
          },
        }),
        { signal },
      );
      if (
        revoked.id !== fresh.editor.id ||
        revoked.epoch !== fresh.editor.epoch ||
        revoked.state !== "revoked"
      )
        throw new Error("Unused editor cleanup is unconfirmed.");
    }
    throw new Error("The saved head changed.");
  }
  return fresh;
}
