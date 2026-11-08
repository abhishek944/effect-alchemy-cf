import { createServer, type Server } from "node:http";
import type { Config } from "./config.ts";
import { createHandler } from "./routes.ts";

export interface Host {
  readonly server: Server;
  readonly listen: () => Promise<number>;
  readonly close: () => Promise<void>;
}

/**
 * Loopback HTTP run host. It exposes only the authenticated run transport: no
 * static files, no UI, no browser-facing surface.
 */
export const createHost = (config: Config): Host => {
  const handle = createHandler(config.token);
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  // A provider-reply body is a live stream, not a bounded-duration upload.
  server.requestTimeout = 0;
  return {
    server,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, "127.0.0.1", () => {
          server.off("error", reject);
          const address = server.address();
          resolve(typeof address === "object" && address !== null ? address.port : config.port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Closing the run sockets invokes RunStream.detach and releases SDK waiters.
        server.closeAllConnections();
      }),
  };
};
