import { createWorktreeCollaborationConfig } from "@univerjs-pro/collaboration-worktree-client";
import type { IUniverCollaborationClientConfig } from "@univerjs-pro/collaboration-client";
import { BrowserCollaborationSocketService } from "@univerjs-pro/collaboration-client-ui";
import type { FrameInit } from "./messages.ts";

export function nativeTransport(input: FrameInit): Partial<IUniverCollaborationClientConfig> {
  const { view } = input;
  const channel = `${location.origin}/api/office/channels/${encodeURIComponent(input.channelId)}/protocol`;
  const viewProtocol = `/api/office/views/${view.id}/protocol`;
  const common = {
    authzUrl: `${channel}${viewProtocol}/authz`,
    signUrlServerUrl: `${channel}${viewProtocol}/images/{fileID}/sign-url`,
    uploadFileServerUrl: `${channel}${viewProtocol}/images/upload`,
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
      snapshotServerUrl: `${channel}${view.protocolPrefix}/snapshot`,
    };
  const origin = location.origin;
  const draft = view.nativeTarget.kind === "draft" ? view.nativeTarget.worktreeId : null;
  const route =
    draft === null ? "/universer-api" : `/universer-api/worktrees/${encodeURIComponent(draft)}`;
  const config =
    draft === null
      ? {
          snapshotServerUrl: `${origin}${route}/snapshot`,
          collabSubmitChangesetUrl: `${origin}${route}/comb`,
        }
      : createWorktreeCollaborationConfig({ origin, worktreeID: draft });
  const scoped = (value: string | undefined, suffix: "snapshot" | "comb") => {
    if (value === undefined) throw new Error("Native SDK route configuration is missing.");
    const url = new URL(value, origin);
    const expectedPath = `${route}/${suffix}`;
    if (
      url.origin !== origin ||
      url.pathname !== expectedPath ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error("Native SDK route does not match its bound branch.");
    return `${channel}${url.pathname}`;
  };
  const snapshotServerUrl = scoped(config.snapshotServerUrl, "snapshot");
  const collabSubmitChangesetUrl = scoped(config.collabSubmitChangesetUrl, "comb");
  const socket = new URL(`${channel}${route}/comb/connect`);
  socket.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return {
    ...config,
    ...common,
    snapshotServerUrl,
    collabSubmitChangesetUrl,
    enableCollaboration: true,
    collabWebSocketUrl: socket.href,
    wsSessionTicketUrl: `${channel}/universer-api/user/session-ticket`,
  };
}
