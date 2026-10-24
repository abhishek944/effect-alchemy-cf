import { Effect } from "effect";
import { withDiagnostic } from "@starter/diagnostics";
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
  if (view === null) throw withDiagnostic(officeDenied(), "channel-view-missing");
  if (view.view.expiresAt <= Date.now())
    throw withDiagnostic(officeDenied(), "channel-view-expired");
  const editor =
    editorId === null
      ? null
      : await Effect.runPromise(active.metadata.editor(root.owner, editorId));
  if (view.view.mode !== "read-only") {
    if (editor === null) throw withDiagnostic(officeDenied(), "channel-editor-missing");
    if (editor.state !== "active") throw withDiagnostic(officeDenied(), "channel-editor-inactive");
    if (editor.expiresAt <= Date.now())
      throw withDiagnostic(officeDenied(), "channel-editor-expired");
    if (editor.view.id !== viewId)
      throw withDiagnostic(officeDenied(), "channel-editor-view-mismatch");
  }
  const placement = await active.placements.current(view.target.documentId);
  if (placement.authorityEpoch !== view.authorityEpoch)
    throw withDiagnostic(officeDenied(), "channel-authority-epoch");
  if (placement.serviceEpoch !== view.serviceEpoch)
    throw withDiagnostic(officeDenied(), "channel-service-epoch");
  // A logical editor channel belongs to its authenticated session, not one hosting/write lease.
  const expiresAt =
    view.view.mode === "read-only"
      ? Math.min(original.deadline, view.view.expiresAt)
      : original.deadline;
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (until: number) => {
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        root.state.waitUntil(
          root.self
            .fetch("http://office-maintenance.internal/channel", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ frameId: channelId }),
            })
            .then(async (response) => {
              await response.body?.cancel();
              if (response.status !== 200) await closeOfficeHostChannel(root, value);
              return undefined;
            })
            .catch(() => closeOfficeHostChannel(root, value))
            .catch(() => undefined),
        );
      },
      Math.min(2147483647, Math.max(1, until - Date.now())),
    );
  };
  const value: OfficeHostChannel = {
    entry,
    binding,
    frames: new Set(),
    expiresAt,
    async maintain() {
      if (value.closing !== undefined) return;
      try {
        const current = await Effect.runPromise(active.metadata.view(root.owner, viewId));
        const lease =
          editorId === null
            ? null
            : await Effect.runPromise(active.metadata.editor(root.owner, editorId));
        const until = Math.min(
          expiresAt,
          current?.view.expiresAt ?? 0,
          lease?.expiresAt ?? expiresAt,
        );
        if (until <= Date.now()) throw officeDenied();
        schedule(until);
      } catch {
        await closeOfficeHostChannel(root, value);
      }
    },
  };
  root.channels.set(channelId, value);
  schedule(Math.min(expiresAt, view.view.expiresAt, editor?.expiresAt ?? expiresAt));
  let timerClosed: (() => void) | undefined;
  const timerDone = new Promise<void>((resolve) => {
    timerClosed = resolve;
  });
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
