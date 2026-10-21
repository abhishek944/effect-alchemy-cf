import type { EndpointSession } from "@univerjs-pro/collaboration-endpoint";
import type {
  NodeHttpTransportContext,
  NodeTransportConnection,
  NodeTransportNext,
  NodeWebSocketUpgradeContext,
} from "@univerjs-pro/collaboration-transport-node";
import type { NativeRoute } from "./routes.ts";

/** Trusted host boundary. Every callback is required; there is no permissive default auth provider. */
export interface OfficeProtocolAuthority {
  /** Verify fresh delegated human/owner/route/target; wrap next in the actual scoped native turn. */
  http(ctx: NodeHttpTransportContext, route: NativeRoute, next: NodeTransportNext): Promise<void>;
  /** Fresh Origin/session/channel/epoch verification, separate from HTTP middleware. */
  upgrade(
    ctx: NodeWebSocketUpgradeContext,
    route: NativeRoute,
    next: NodeTransportNext,
  ): Promise<void>;
  /** Re-enter the bounded read scope for each real SDK callback, not a long-lived write permit. */
  socket(
    connection: NodeTransportConnection,
    route: NativeRoute,
    next: () => void | Promise<void>,
  ): Promise<void>;
  /** Ticket-derived session; validate branch, expiry/epoch and actual join target. */
  session(
    session: EndpointSession,
    worktreeId: string | null,
    unitId: string | null,
  ): Promise<void>;
  /** Cleanup only: must remain available after expiry/revocation. */
  closed(connection: NodeTransportConnection): void;
}
export interface OfficeViewProtocol {
  /** Actual owner/View-bound permission reads; never AuthzIoLocalService or allow-all. */
  permissions(ctx: NodeHttpTransportContext): Promise<void>;
  /** Owner/document native-file mapping; response URL is fixed same-origin Artifact bytes only. */
  imageSign(ctx: NodeHttpTransportContext): Promise<void>;
  /** Current writable editor + exact View/branch/lifecycle, bounded MIME/size/assign validation. */
  imageUpload(ctx: NodeHttpTransportContext): Promise<void>;
  /** Resolve the actual View: exact read-only source when pinned, current bound branch when live. */
  snapshot(ctx: NodeHttpTransportContext): Promise<void>;
}
