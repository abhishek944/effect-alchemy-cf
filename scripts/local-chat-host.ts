import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

/** Local-only service credentials are ephemeral and never written or printed. */
export async function startLocalChatHost() {
  const port = 1338;
  const token = randomBytes(32).toString("hex");
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL("../apps/chat-host/src/main.ts", import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, CHAT_HOST_PORT: String(port), CHAT_HOST_TOKEN: token },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const closed = new Promise<number | null>((resolve) => child.once("exit", resolve));
  let stopping = false;
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    stopping = true;
    child.kill("SIGTERM");
    await closed;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const onData = (chunk: Buffer | string): void => {
        const text = String(chunk);
        process.stdout.write(text);
        output += text;
        if (output.includes(`chat-host listening on 127.0.0.1:${port}`)) {
          child.stdout?.off("data", onData);
          child.stdout?.pipe(process.stdout);
          resolve(undefined);
        }
      };
      child.stdout?.on("data", onData);
      child.once("error", () => reject(new Error("Local Pi host could not start.")));
      child.once("exit", () => reject(new Error("Local Pi host exited before readiness.")));
    });
  } catch (error) {
    await close();
    throw error;
  }
  return {
    environment: { CHAT_HOST_URL: `http://127.0.0.1:${port}`, CHAT_HOST_TOKEN: token },
    close,
    /** An unexpected service exit must also end the owning local API process. */
    onExit(callback: () => void): void {
      child.once("exit", () => {
        if (!stopping) callback();
      });
    },
  };
}
