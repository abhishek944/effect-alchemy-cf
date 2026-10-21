import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Schema } from "effect";
import type { DockerClient } from "./docker-client.ts";
import { createArguments } from "./profile.ts";
import {
  DockerExecutorError,
  type DockerExecutionResult,
  type DockerExecutionStatus,
} from "./types.ts";

const parseId = Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)));

/** One finite byte invocation. Cleanup is separate from Docker CLI termination. */
export async function executeDockerJob(
  client: DockerClient,
  input: Uint8Array,
  signal: AbortSignal,
): Promise<DockerExecutionResult> {
  const name = `office-job-${randomUUID()}`;
  const { limits } = client.config;
  let identity: string | undefined;
  let creationAttempted = false;
  let uncertainCreate = false;
  let status: DockerExecutionStatus = "exited";
  let child: ChildProcessWithoutNullStreams | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let stopWait: (() => void) | undefined;
  let cleanup: Promise<void> | undefined;
  const remove = () => {
    cleanup ??= client.remove(identity ?? name, name);
    // Removal can reject before attach drains; finally still awaits and propagates it.
    void cleanup.catch(() => undefined);
    return cleanup;
  };
  const interrupt = (reason: DockerExecutionStatus) => {
    if (status !== "exited") return;
    status = reason;
    child?.stdin.destroy();
    child?.kill("SIGKILL");
    if (identity !== undefined) void remove();
    // Never wait forever if a killed CLI's pipes fail to close.
    drainTimer = setTimeout(() => stopWait?.(), 1000);
  };
  const onAbort = () => interrupt("cancelled");
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => interrupt("timed-out"), limits.wallTimeMs);
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let exitCode: number | null = null;
  let failure: DockerExecutorError | undefined;
  try {
    exitCode = await launch();
  } catch (error) {
    failure =
      error instanceof DockerExecutorError
        ? error
        : new DockerExecutorError({
            code: "DOCKER_CONTROL_FAILED",
            message: "Docker job lifecycle failed.",
            containerName: name,
          });
  } finally {
    clearTimeout(timer);
    if (drainTimer !== undefined) clearTimeout(drainTimer);
    signal.removeEventListener("abort", onAbort);
    child?.stdin.destroy();
    if (child?.exitCode === null) child.kill("SIGKILL");
    if (creationAttempted) await remove();
  }
  if (uncertainCreate)
    throw new DockerExecutorError({
      code: "CLEANUP_UNCERTAIN",
      message: "Create acknowledgement was lost; late daemon creation cannot be excluded.",
      containerName: name,
    });
  if (failure !== undefined) throw failure;
  if (signal.aborted && status === "exited") status = "cancelled";
  return {
    containerName: name,
    status,
    exitCode,
    stdout: status === "exited" ? Buffer.concat(stdout) : new Uint8Array(),
    stderr: status === "exited" ? Buffer.concat(stderr) : new Uint8Array(),
    stdoutBytes,
    stderrBytes,
    cleanup: "confirmed",
  };

  async function launch(): Promise<number | null> {
    if (signal.aborted) onAbort();
    if (status !== "exited") return null;
    try {
      creationAttempted = true;
      const creation = await client.call(createArguments(client, name));
      if (creation.code !== 0)
        throw new DockerExecutorError({
          code: "DOCKER_CONTROL_FAILED",
          message: "Docker could not create the constrained container.",
          containerName: name,
        });
      try {
        identity = parseId(creation.stdout.trim());
      } catch {
        uncertainCreate = true;
        throw new DockerExecutorError({
          code: "CONTROL_UNCERTAIN",
          message: "Docker returned an invalid created-container identity.",
          containerName: name,
        });
      }
    } catch (error) {
      if (error instanceof DockerExecutorError && error.code === "CONTROL_UNCERTAIN")
        uncertainCreate = true;
      throw error;
    }
    if (signal.aborted) onAbort();
    if (status !== "exited") return null;
    const containerId = identity;
    if (containerId === undefined)
      throw new DockerExecutorError({
        code: "CONTROL_UNCERTAIN",
        message: "Created container identity is missing.",
        containerName: name,
      });
    const attachedExitCode = await new Promise<number | null>((resolve, reject) => {
      child = spawn(
        client.config.dockerPath,
        [...client.arguments, "container", "start", "--attach", "--interactive", containerId],
        {
          cwd: client.directory,
          env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
          shell: false,
          detached: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let done = false;
      const finish = (code: number | null, failed = false) => {
        if (done) return;
        done = true;
        if (failed)
          reject(
            new DockerExecutorError({
              code: "DOCKER_CONTROL_FAILED",
              message: "Docker attach process failed.",
              containerName: name,
            }),
          );
        else resolve(code);
      };
      stopWait = () => finish(null);
      const collect = (chunk: Buffer, channel: "stdout" | "stderr") => {
        if (status !== "exited") return;
        if (channel === "stdout") stdoutBytes += chunk.length;
        else stderrBytes += chunk.length;
        if (stdoutBytes > limits.maxStdoutBytes || stderrBytes > limits.maxStderrBytes) {
          stdout.length = 0;
          stderr.length = 0;
          interrupt("output-limit");
        } else (channel === "stdout" ? stdout : stderr).push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
      child.stdout.once("error", () => finish(null, true));
      child.stderr.once("error", () => finish(null, true));
      child.once("error", () => finish(null, true));
      child.once("close", (code) => finish(code, code === null && status === "exited"));
      child.stdin.on("error", () => {
        /* Early child exit can close stdin; exit status remains authoritative. */
      });
      if (signal.aborted) onAbort();
      if (status === "exited") child.stdin.end(input);
    });
    return status === "exited" ? client.exitCode(containerId) : attachedExitCode;
  }
}
