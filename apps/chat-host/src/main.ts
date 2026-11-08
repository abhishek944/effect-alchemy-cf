import { readConfig } from "./config.ts";
import { createHost } from "./server.ts";

const start = async (): Promise<void> => {
  const config = readConfig();
  const host = createHost(config);
  const port = await host.listen();
  const shutdown = () => {
    void host.close().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdout.write(`chat-host listening on 127.0.0.1:${port}\n`);
};

await start();
