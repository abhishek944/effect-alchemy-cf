import { Effect } from "effect";
import type { OfficeInvocation } from "./office-invocations.ts";
import { officeDenied } from "./office-private-authority.ts";
import { officeEditorChannel } from "./office-editor-channel.ts";
import { officeEditorGrants } from "./office-editor-grants.ts";
import { officeHostEntry, closeOfficeHostEntry } from "./office-host-entry.ts";
import type {
  OfficeHostActive,
  OfficeHostChannel,
  OfficeHostRuntime,
} from "./office-host-state.ts";

export async function createOfficeHostChannel(
  root: OfficeHostRuntime,
  active: OfficeHostActive,
  original: OfficeInvocation,
  viewId: string,
  editorId: string | null,
) {
  const view = await Effect.runPromise(active.metadata.view(root.owner, viewId));
  if (view === null || view.view.expiresAt <= Date.now()) throw officeDenied();
  const editor =
    editorId === null
      ? null
      : await Effect.runPromise(active.metadata.editor(root.owner, editorId));
  if (
    view.view.mode !== "read-only" &&
    (editor === null ||
      editor.state !== "active" ||
      editor.expiresAt <= Date.now() ||
      editor.view.id !== viewId)
  )
    throw officeDenied();
  const placement = await active.placements.current(view.target.documentId);
  if (
    placement.authorityEpoch !== view.authorityEpoch ||
    placement.serviceEpoch !== view.serviceEpoch
  )
    throw officeDenied();
  const expiresAt = Math.min(
    original.deadline,
    view.view.expiresAt,
    editor?.expiresAt ?? original.deadline,
    view.view.mode === "read-only" ? original.deadline : placement.until,
  );
  const entry = officeHostEntry(root, active, original, {
    command: null,
    view,
    binding: null,
    channelId: null,
    canonical: true,
    kind: "http",
    deadline: expiresAt,
    access: null,
    file: null,
  });
  const channelId = entry.frame.id;
  const channel = officeEditorChannel(
    active.options,
    active.metadata,
    entry.frame.request,
    active.nodeId,
    channelId,
    view,
    editor,
    expiresAt,
  );
  const binding = { channel, grants: officeEditorGrants(channel) };
  const value: OfficeHostChannel = { entry, binding, frames: new Set(), expiresAt };
  root.channels.set(channelId, value);
  let timerClosed: (() => void) | undefined;
  const timerDone = new Promise<void>((resolve) => {
    timerClosed = resolve;
  });
  const timer = setTimeout(
    () => {
      timerClosed?.();
      root.state.waitUntil(closeOfficeHostChannel(root, value).catch(() => undefined));
    },
    Math.max(0, expiresAt - Date.now()),
  );
  entry.frame.request.keepIO(
    {
      close: async () => {
        clearTimeout(timer);
        timerClosed?.();
      },
      drain: () => timerDone,
    },
    true,
  );
  return { channelId, expiresAt, protocolBase: `/api/office/channels/${channelId}` };
}

export function closeOfficeHostChannel(
  root: OfficeHostRuntime,
  channel: OfficeHostChannel,
): Promise<void> {
  if (channel.closing !== undefined) return channel.closing;
  channel.closing = Promise.resolve().then(async () => {
    channel.entry.frame.revoke();
    for (const child of channel.frames) child.frame.revoke();
    const revoked = await Promise.allSettled([
      channel.binding.channel.revoke(),
      channel.binding.grants.drain(),
    ]);
    const frames = await Promise.allSettled(
      [...channel.frames].map((entry) => closeOfficeHostEntry(root, entry)),
    );
    const failures: unknown[] = [];
    for (const result of [...revoked, ...frames])
      if (result.status === "rejected") failures.push(result.reason);
    // Child failure must not release the canonical registration or failed child capacity.
    if (failures.length > 0) channel.entry.frame.failCleanup();
    channel.entry.frame.stopCleanup();
    const canonical = await Promise.allSettled([closeOfficeHostEntry(root, channel.entry)]);
    for (const result of canonical) if (result.status === "rejected") failures.push(result.reason);
    if (failures.length > 0)
      throw new AggregateError(failures, "Office channel cleanup failed", { cause: failures[0] });
    for (const child of channel.frames) root.entries.delete(child.frame.id);
    root.channels.delete(channel.entry.frame.id);
    return undefined;
  });
  return channel.closing;
}
