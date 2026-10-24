import type { HostOfficeRequest } from "@starter/office-server/native-remote";
import { withCause, withDiagnostic } from "@starter/diagnostics";
import type { NativeAccess, ViewRecord } from "@starter/office-server/ports";
import type { OfficeInvocation } from "./office-invocations.ts";
import type { NativePrivateResolution } from "../../office/src/native-private-wire.ts";
import { OfficeHostFrame } from "./office-host-frame.ts";
import { officePrivateBackend } from "./office-private-backend.ts";
import type { OfficeEditorBinding } from "./office-editor-grants.ts";
import type { OfficeHostActive, OfficeHostEntry, OfficeHostRuntime } from "./office-host-state.ts";
import { officeDenied } from "./office-private-authority.ts";

export function officeHostEntry(
  root: OfficeHostRuntime,
  active: OfficeHostActive,
  original: OfficeInvocation,
  options: {
    readonly command: HostOfficeRequest | null;
    readonly view: ViewRecord | null;
    readonly binding: OfficeEditorBinding | null;
    readonly channelId: string | null;
    readonly canonical: boolean;
    readonly kind: "http" | "upgrade";
    readonly deadline: number;
    readonly access: NativeAccess | null;
    readonly file: NativePrivateResolution["file"];
  },
): OfficeHostEntry {
  if (root.closing) throw withDiagnostic(officeDenied(), "entry-closing");
  if (root.entries.size >= 128) throw withDiagnostic(officeDenied(), "entry-capacity");
  const frame = new OfficeHostFrame({
    original,
    command: options.command,
    file: options.file,
    viewId: options.view?.view.id ?? null,
    kind: options.kind,
    self: root.self,
    placements: active.placements,
    onStalled: () => root.state.waitUntil(root.close().catch(() => undefined)),
  });
  const backend = officePrivateBackend(
    active.options,
    active.metadata,
    frame.request,
    root.namespace,
    {
      nodeId: active.nodeId,
      imageDigest: root.policy.imageDigest,
      policyVersion: root.policy.version,
      nativeAttempts: root.nativeAttempts,
    },
    options.binding,
  );
  const resolution: NativePrivateResolution = {
    invocationId: frame.id,
    kind: options.view === null ? "core" : "protocol",
    actor: original.actor,
    view: options.view,
    unit: null,
    access: options.access,
    worktreeId: options.view?.source.kind === "draft" ? options.view.source.worktreeId : null,
    editorId: options.binding?.channel.editor?.id ?? null,
    channelId: options.channelId,
    deadline: Math.min(original.deadline, options.deadline),
    cleanupDeadline: frame.cleanupDeadline,
    file: options.file,
  };
  const entry = {
    frame,
    backend,
    resolution,
    canonical: options.canonical,
    channelId: options.channelId,
  };
  root.entries.set(frame.id, entry);
  return entry;
}

/** Normal body owner calls only AFTER source response reader is closed; never from a private callback. */
export function closeOfficeHostEntry(
  root: OfficeHostRuntime,
  entry: OfficeHostEntry,
): Promise<void> {
  if (entry.closing !== undefined) return entry.closing;
  entry.closing = Promise.resolve().then(async () => {
    const failures: unknown[] = [];
    const join = async (reason: string, body: () => Promise<unknown>) => {
      try {
        await body();
      } catch (error) {
        failures.push(withCause(withDiagnostic(officeDenied(), reason), error));
        entry.frame.revoke();
      }
    };
    if (!entry.canonical) {
      await join("entry-native-finish", () =>
        Promise.race([entry.frame.nativeFinished, root.process.actualGone]),
      );
      // A failed logical report never skips the separate actual upgrade socket join.
      if (entry.frame.kind === "upgrade")
        await join("entry-socket-close", () =>
          Promise.race([entry.frame.socketClosed, root.process.actualGone]),
        );
    }
    entry.frame.revoke();
    await join("entry-io-before-sdk", () => entry.frame.io.drain());
    if (entry.frame.sdkExpected)
      await join("entry-sdk-close", () =>
        Promise.race([entry.frame.sdkClosed, root.process.actualGone]),
      );
    await join("entry-io-after-sdk", () => entry.frame.io.drain());
    await join("entry-provider-drain", () => entry.backend.drain());
    if (entry.frame.cleanupFailed)
      failures.push(withDiagnostic(officeDenied(), "entry-cleanup-reported-failed"));
    if (failures.length > 0)
      throw new AggregateError(failures, "Office entry cleanup failed", { cause: failures[0] });
    entry.frame.complete();
    // All native/socket/SDK/IO joins passed. Retain only canonical identity, not closed children.
    if (entry.channelId !== null) {
      root.entries.delete(entry.frame.id);
      root.channels.get(entry.channelId)?.frames.delete(entry);
    }
    if (entry.channelId === null) {
      root.entries.delete(entry.frame.id);
      root.registry.release(entry.frame.original);
    }
    return undefined;
  });
  return entry.closing;
}
