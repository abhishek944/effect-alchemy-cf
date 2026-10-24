import {
  createNodeTransport,
  type NodeTransportConnection,
} from "@univerjs-pro/collaboration-transport-node";
import {
  MemorySessionTicketStore,
  UniverCollabEndpoint,
  type EndpointSession,
  type ReceivePresenceEndpointMiddlewareContext,
} from "@univerjs-pro/collaboration-endpoint";
import {
  UniverCollabWorktreeEndpoint,
  type ReceiveWorktreePresenceEndpointMiddlewareContext,
} from "@univerjs-pro/collaboration-worktree-endpoint";
import type { NativeServices } from "../core/native-services.ts";
import type { OfficeProtocolAuthority, OfficeViewProtocol } from "./types.ts";
import { classifyNativeRoute } from "./routes.ts";
import { nativeEndpointRouter } from "./router.ts";
import { submissionServices, type OfficeSubmissionAuthority } from "./submission-services.ts";

export type { OfficeProtocolAuthority, OfficeViewProtocol } from "./types.ts";
export type { OfficeSubmissionAuthority } from "./submission-services.ts";
export { evaluateNativePermissions, type PermissionChannel } from "./authz.ts";
export { evaluateViewPermissions } from "./view-permissions.ts";
export { classifyNativeRoute } from "./routes.ts";
/** Draft-only membership: the SDK already owns real Main joined-member state. */
type DraftJoined = {
  readonly session: EndpointSession;
  readonly worktreeId: string;
  readonly units: Set<string>;
};
/** Real SDK endpoints/transport only. Host authority callbacks acquire each actual fenced scope. */
export function createOfficeProtocol(
  services: NativeServices,
  authority: OfficeProtocolAuthority,
  views: OfficeViewProtocol,
  submissions: OfficeSubmissionAuthority,
) {
  const endpointServices = submissionServices(services, submissions);
  const transport = createNodeTransport({
    maxRequestBodyBytes: 16 * 1024 * 1024,
    maxWebSocketMessageBytes: 16 * 1024 * 1024,
  });
  const tickets = new MemorySessionTicketStore();
  const main = new UniverCollabEndpoint(endpointServices.main, {
    ticketStore: tickets,
    sessionTicketTtlMs: 30_000,
  });
  const drafts = new UniverCollabWorktreeEndpoint(endpointServices.drafts, {
    ticketStore: tickets,
    sessionTicketTtlMs: 30_000,
  });
  const joined = new Map<string, DraftJoined>();
  const connections = new Map<string, NodeTransportConnection>();
  const forget = (connection: NodeTransportConnection) => {
    connections.delete(connection.id);
    joined.delete(connection.id);
    authority.closed(connection);
  };
  /** Physical transport tracking only; it proves neither membership nor authority. */
  const attach = (connection: NodeTransportConnection) => {
    if (connections.size >= 64) {
      connection.close(1013, "Office channel limit");
      return false;
    }
    connections.set(connection.id, connection);
    return true;
  };
  main.use("connect", async (ctx, next) => {
    await authority.session(ctx.session, null, null);
    await next();
    attach(ctx.connection);
  });
  drafts.use("connect", async (ctx, next) => {
    await authority.session(ctx.session, ctx.worktreeID, null);
    await next();
    if (attach(ctx.connection))
      joined.set(ctx.connection.id, {
        session: ctx.session,
        worktreeId: ctx.worktreeID,
        units: new Set(),
      });
  });
  main.use("joinUnit", async (ctx, next) => {
    await authority.session(ctx.session, null, ctx.unitID);
    await next();
  });
  drafts.use("joinUnit", async (ctx, next) => {
    await authority.session(ctx.session, ctx.worktreeID, ctx.unitID);
    await next();
    for (const entry of joined.values())
      if (entry.session === ctx.session) entry.units.add(ctx.unitID);
  });
  drafts.on("memberLeftUnit", (event) => {
    for (const entry of joined.values())
      if (entry.session === event.session) entry.units.delete(event.unitID);
  });
  for (const action of ["receivePresence", "sendPresence"] as const) {
    main.use(
      action,
      async (ctx: ReceivePresenceEndpointMiddlewareContext, next: () => Promise<void>) => {
        await authority.session(ctx.session, null, ctx.unitID);
        await next();
      },
    );
    drafts.use(
      action,
      async (ctx: ReceiveWorktreePresenceEndpointMiddlewareContext, next: () => Promise<void>) => {
        await authority.session(ctx.session, ctx.worktreeID, ctx.unitID);
        await next();
      },
    );
  }
  transport.use(async (ctx, next) => {
    ctx.response.setHeader("Cache-Control", "private, no-store");
    const route = classifyNativeRoute(
      ctx.incomingMessage.method ?? "",
      ctx.incomingMessage.url ?? "",
    );
    if (route === null) {
      ctx.response.writeHead(404).end();
      return;
    }
    await authority.http(ctx, route, next);
  });
  transport.useUpgrade(async (ctx, next) => {
    const route = classifyNativeRoute("UPGRADE", ctx.incomingMessage.url ?? "");
    if (ctx.incomingMessage.method !== "GET" || route === null) {
      ctx.reject(404);
      return;
    }
    await authority.upgrade(ctx, route, next);
  });
  transport.register(nativeEndpointRouter(main, drafts, authority, views, forget));
  return {
    transport,
    /** Extra validation only. Worktree SDK still enforces its own real joined-member state. */
    joinedSession(worktreeId: string | null, unitId: string, memberId: string, userId: string) {
      if (worktreeId === null)
        return main.findJoinedSession({
          unitID: unitId,
          memberID: memberId,
          authenticatedUserID: userId,
        });
      return (
        [...joined.values()].find(
          (entry) =>
            entry.worktreeId === worktreeId &&
            entry.units.has(unitId) &&
            entry.session.memberID === memberId &&
            entry.session.userID === userId,
        )?.session ?? null
      );
    },
    async dispose() {
      for (const connection of connections.values())
        connection.close(1001, "Office channel closed");
      connections.clear();
      joined.clear();
      await transport.dispose();
      await drafts.dispose();
      await main.dispose();
      await tickets.dispose();
    },
  };
}
