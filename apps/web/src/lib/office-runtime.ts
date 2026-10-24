import { Effect } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { officeFail, type OfficeRuntimePhase } from "@/lib/browser-diagnostics";
import { makeOfficeClient } from "@starter/office-contract/client";
import type { Editor, OfficeChannel, Target, View } from "@starter/office-contract";
import type { OfficeRuntime, OfficeSave } from "@starter/office-react";

/** Browser boundary: existing same-origin human authentication, no provider or server imports. */
export async function createOfficeRuntime(): Promise<OfficeRuntime> {
  try {
    const client = await Effect.runPromise(
      makeOfficeClient(location.origin).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.RequestInit, { credentials: "same-origin" }),
      ),
    );
    return { client, run: (effect, options) => Effect.runPromise(effect, options) };
  } catch (cause) {
    throw officeFail("office.open", "init", "runtime-unavailable", null, cause);
  }
}
export type OpenOffice = { view: View; editor: Editor | null; channel: OfficeChannel };
export function assertOfficeViewTarget(view: View, target: Target): void {
  if (view.documentId !== target.documentId)
    throw officeFail("office.session", "snapshot", "document-changed", view.id);
  if (view.nativeTarget.kind === "pinned-snapshot") {
    if (view.mode !== "read-only")
      throw officeFail("office.session", "snapshot", "frozen-view", view.id);
  } else if (target.scope.kind === "draft") {
    if (
      view.nativeTarget.kind !== "draft" ||
      view.nativeTarget.generation !== target.scope.generation
    )
      throw officeFail("office.session", "snapshot", "generation-changed", view.id);
  } else if (view.nativeTarget.kind !== "main")
    throw officeFail("office.session", "snapshot", "branch-changed", view.id);
}

/** Initial explicit open only. A later save/reanchor must also compare the exact held ACK. */
export async function openOffice(
  runtime: OfficeRuntime,
  target: Target,
  signal: AbortSignal,
): Promise<OpenOffice> {
  const options = { signal };
  let stage = { phase: "snapshot" as OfficeRuntimePhase, reason: "open-unconfirmed" };
  let viewId: string | null = null;
  try {
    const first = await runtime.run(runtime.client.office.open({ payload: target }), options);
    signal.throwIfAborted();
    assertOfficeViewTarget(first, target);
    viewId = first.id;
    stage = { phase: "input", reason: "editor-unavailable" };
    const editor =
      first.mode === "edit"
        ? await runtime.run(
            runtime.client.office.editor({ payload: { kind: "acquire", target } }),
            options,
          )
        : null;
    signal.throwIfAborted();
    const view = editor?.view ?? first;
    viewId = view.id;
    assertOfficeViewTarget(view, target);
    if (editor !== null && (editor.state !== "active" || editor.expiresAt <= Date.now()))
      throw officeFail("office.open", stage.phase, stage.reason, view.id);
    stage = { phase: "ack", reason: "channel-unconfirmed" };
    const channel = await runtime.run(
      runtime.client.office.channel({ payload: { viewId: view.id, editorId: editor?.id ?? null } }),
      options,
    );
    signal.throwIfAborted();
    if (channel.expiresAt <= Date.now())
      throw officeFail("office.open", "ack", "channel-expired", view.id);
    return { view, editor, channel };
  } catch (cause) {
    throw officeFail("office.open", stage.phase, stage.reason, viewId, cause, signal);
  }
}

export async function drainOffice(
  runtime: OfficeRuntime,
  opened: OpenOffice,
  saved: OfficeSave,
  signal: AbortSignal,
): Promise<OpenOffice> {
  signal.throwIfAborted();
  if (
    opened.editor === null ||
    saved.viewId !== opened.view.id ||
    !Number.isSafeInteger(saved.revision) ||
    saved.revision < opened.view.revision
  )
    throw officeFail("office.drain", "flush", "ack-unavailable", opened.view.id);
  try {
    const editor = await runtime.run(
      runtime.client.office.editor({
        payload: { kind: "drained", editorId: opened.editor.id, confirmedRevision: saved.revision },
      }),
      { signal },
    );
    signal.throwIfAborted();
    if (
      editor.id !== opened.editor.id ||
      editor.epoch !== opened.editor.epoch ||
      editor.state !== "drained"
    )
      throw officeFail("office.drain", "flush", "drain-unconfirmed", opened.view.id);
    return { ...opened, editor };
  } catch (cause) {
    throw officeFail("office.drain", "flush", "drain-unconfirmed", opened.view.id, cause, signal);
  }
}
