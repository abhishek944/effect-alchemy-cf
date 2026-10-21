import type { UniverCollabEndpoint } from "@univerjs-pro/collaboration-endpoint";
import type { UniverCollabWorktreeEndpoint } from "@univerjs-pro/collaboration-worktree-endpoint";
import type {
  NodeRouter,
  NodeTransportEndpoint,
  NodeTransportConnection,
  NodeWebSocketHandler,
} from "@univerjs-pro/collaboration-transport-node";
import type { OfficeProtocolAuthority, OfficeViewProtocol } from "./types.ts";
import { classifyNativeRoute, nativeRegistrations, type NativeRoute } from "./routes.ts";

/** Public router decoration. Never reaches private Endpoint fields or translates arbitrary upstream URLs. */
export function nativeEndpointRouter(
  main: UniverCollabEndpoint,
  drafts: UniverCollabWorktreeEndpoint,
  authority: OfficeProtocolAuthority,
  views: OfficeViewProtocol,
  closed: (connection: NodeTransportConnection) => void,
): NodeTransportEndpoint {
  const wrap = (handler: NodeWebSocketHandler, route: NativeRoute): NodeWebSocketHandler => ({
    open: (ctx) => authority.socket(ctx.connection, route, () => handler.open?.(ctx)),
    message: (ctx) => authority.socket(ctx.connection, route, () => handler.message?.(ctx)),
    close: async (ctx) => {
      try {
        await handler.close?.(ctx);
      } finally {
        closed(ctx.connection);
      }
    },
  });
  return {
    register(router: NodeRouter) {
      const installed = new Set<string>();
      const denied = new Set<string>();
      const filtered: NodeRouter = {
        get(path, handler) {
          const key = `GET ${path}`;
          if (!nativeRegistrations.has(key)) {
            denied.add(key);
            return;
          }
          if (!installed.has(key)) {
            installed.add(key);
            router.get(path, handler);
          }
        },
        post(path, handler) {
          const key = `POST ${path}`;
          if (nativeRegistrations.has(key)) router.post(path, handler);
          else denied.add(key);
        },
        delete(path) {
          denied.add(`DELETE ${path}`);
        },
        upgrade(path, handler) {
          const key = `UPGRADE ${path}`;
          if (!nativeRegistrations.has(key)) {
            denied.add(key);
            return;
          }
          router.upgrade(path, (ctx) => {
            const route = classifyNativeRoute("UPGRADE", ctx.incomingMessage.url ?? "");
            if (route === null) {
              ctx.reject(404, "Office channel unavailable");
              return;
            }
            return handler({
              incomingMessage: ctx.incomingMessage,
              customData: ctx.customData,
              params: ctx.params,
              ...(ctx.route === undefined ? {} : { route: ctx.route }),
              reject: (status, message) => ctx.reject(status, message),
              accept: (callbacks) => ctx.accept(wrap(callbacks, route)),
            });
          });
        },
      };
      main.register(filtered);
      drafts.register(filtered);
      const view = "/api/office/views/:viewID/protocol";
      router.post(`${view}/authz/-/object/-/batch_allowed`, (ctx) => views.permissions(ctx));
      router.get(`${view}/images/:fileID/sign-url`, (ctx) => views.imageSign(ctx));
      router.post(`${view}/images/upload`, (ctx) => views.imageUpload(ctx));
      for (const suffix of [
        "snapshot/:type/unit/:unitID/rev/:revision",
        "snapshot/:type/unit/:unitID/block/:blockID",
        "snapshot/block/:type/unit/:unitID/block/:blockID",
        "snapshot/:type/unit/:unitID/fetchmissing",
      ])
        router.get(`${view}/${suffix}`, (ctx) => views.snapshot(ctx));
    },
  };
}
