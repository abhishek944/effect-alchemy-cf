import { createWorktreeCollaborationConfig } from "@univerjs-pro/collaboration-worktree-client";
import type { IUniverCollaborationClientConfig } from "@univerjs-pro/collaboration-client";
import { BrowserCollaborationSocketService } from "@univerjs-pro/collaboration-client-ui";
import type { FrameInit } from "./messages.ts";

export function nativeTransport(input: FrameInit): Partial<IUniverCollaborationClientConfig> {
  const { view } = input;
  const viewProtocol = `${location.origin}/api/office/views/${view.id}/protocol`;
  const common = {
    authzUrl: `${viewProtocol}/authz`,
    signUrlServerUrl: `${viewProtocol}/images/{fileID}/sign-url`,
    uploadFileServerUrl: `${viewProtocol}/images/upload`,
    downloadEndpointUrl: location.origin,
    socketService: BrowserCollaborationSocketService,
    enableAuthServer: true,
    enableOfflineEditing: false,
    enableSingleActiveInstanceLock: false,
  };
  if (view.nativeTarget.kind === "pinned-snapshot")
    return {
      ...common,
      enableCollaboration: false,
      snapshotServerUrl: `${view.protocolPrefix}/snapshot`,
    };
  const origin = location.origin;
  const draft = view.nativeTarget.kind === "draft" ? view.nativeTarget.worktreeId : null;
  const route =
    draft === null ? "/universer-api" : `/universer-api/worktrees/${encodeURIComponent(draft)}`;
  const config =
    draft === null
      ? {
          snapshotServerUrl: `${viewProtocol}/snapshot`,
          collabSubmitChangesetUrl: `${origin}${route}/comb`,
        }
      : createWorktreeCollaborationConfig({ origin, worktreeID: draft });
  for (const [value, suffix] of [
    [config.snapshotServerUrl, "snapshot"],
    [config.collabSubmitChangesetUrl, "comb"],
  ]) {
    if (value === undefined) throw new Error("Native SDK route configuration is missing.");
    const url = new URL(value, origin);
    const expectedPath =
      draft === null && suffix === "snapshot"
        ? `/api/office/views/${view.id}/protocol/snapshot`
        : `${route}/${suffix}`;
    if (
      url.origin !== origin ||
      url.pathname !== expectedPath ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error("Native SDK route does not match its bound branch.");
  }
  const socket = new URL(`${route}/comb/connect`, origin);
  socket.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return {
    ...config,
    ...common,
    enableCollaboration: true,
    collabWebSocketUrl: socket.href,
    wsSessionTicketUrl: `${origin}/universer-api/user/session-ticket?channelId=${encodeURIComponent(input.channelId)}`,
  };
}
