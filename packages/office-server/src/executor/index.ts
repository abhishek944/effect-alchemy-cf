import { constants } from "node:fs";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDockerClient, verifyDockerImage } from "./docker-client.ts";
import { executeDockerJob } from "./job.ts";
import { verifyDockerSupport } from "./profile.ts";
import {
  DockerExecutorError,
  resolveDockerConfig,
  type DockerExecutor,
  type DockerExecutorConfig,
  type DockerExecutionResult,
} from "./types.ts";

export { DEFAULT_DOCKER_LIMITS, DockerExecutorError } from "./types.ts";
export type {
  DockerExecutor,
  DockerExecutorConfig,
  DockerExecutorErrorCode,
  DockerExecutionResult,
  DockerExecutionStatus,
  DockerLimits,
} from "./types.ts";

const owners = new Set<string>();
const removeClientDirectory = async (directory: string): Promise<void> => {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    throw new DockerExecutorError({
      code: "CLEANUP_UNCERTAIN",
      message: "Could not remove the private Docker client directory.",
    });
  }
};

/**
 * Node-only adapter. Caller owns one exclusive supervisor per stable owner namespace,
 * including across OS processes. Startup removes only that namespace's labelled jobs.
 * Always await close() in finally. Image/entrypoint and baked image contents are trusted.
 * This primitive never interprets stdout, retries a job, or claims an application commit.
 */
export async function createDockerExecutor(
  configuration: DockerExecutorConfig,
): Promise<DockerExecutor> {
  const config = resolveDockerConfig(configuration);
  const ownerKey = `${config.socketPath}:${config.owner}`;
  if (owners.has(ownerKey))
    throw new DockerExecutorError({
      code: "INVALID_CONFIG",
      message: "This executor owner already has a supervisor in this process.",
    });
  owners.add(ownerKey);
  let directory: string;
  try {
    await access(config.dockerPath, constants.X_OK);
    if (!(await stat(config.socketPath)).isSocket()) throw new Error("Not a local Unix socket.");
    directory = await mkdtemp(join(tmpdir(), "office-docker-client-"));
  } catch {
    owners.delete(ownerKey);
    throw new DockerExecutorError({
      code: "INVALID_CONFIG",
      message: "Docker executable or local socket is unavailable.",
    });
  }
  const client = createDockerClient(config, directory);
  const active = new Map<Promise<DockerExecutionResult>, AbortController>();
  let closed = false;
  let cleanupFailed = false;
  let closing: Promise<void> | undefined;
  let reconciledContainers: readonly string[];
  try {
    await verifyDockerSupport(client);
    reconciledContainers = Object.freeze([...(await client.reconcile())]);
    await verifyDockerImage(client);
  } catch (error) {
    owners.delete(ownerKey);
    await removeClientDirectory(directory);
    throw error;
  }
  const run: DockerExecutor["run"] = async (input, signal) => {
    if (closed)
      throw new DockerExecutorError({
        code: "EXECUTOR_CLOSED",
        message: "Docker executor is closed.",
      });
    if (active.size >= config.limits.concurrency)
      throw new DockerExecutorError({
        code: "CAPACITY_EXCEEDED",
        message: "Docker executor admission capacity is exhausted.",
      });
    if (!(input instanceof Uint8Array) || input.byteLength > config.limits.maxInputBytes) {
      throw new DockerExecutorError({
        code: "INPUT_LIMIT",
        message: "Executor stdin exceeds the finite byte budget.",
      });
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    // Copy only the already-bounded bytes, so callers cannot mutate accepted stdin later.
    const task = executeDockerJob(client, Buffer.from(input), controller.signal);
    active.set(task, controller);
    try {
      const result = await task;
      if (controller.signal.aborted && result.status === "exited")
        return {
          ...result,
          status: "cancelled",
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        };
      return result;
    } catch (error) {
      if (error instanceof DockerExecutorError && error.code === "CLEANUP_UNCERTAIN") {
        cleanupFailed = true;
        closed = true;
        for (const running of active.values()) running.abort();
      }
      throw error;
    } finally {
      active.delete(task);
      signal?.removeEventListener("abort", abort);
    }
  };
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      closed = true;
      const tasks = [...active.keys()];
      for (const controller of active.values()) controller.abort();
      const results = await Promise.allSettled(tasks);
      try {
        if (
          cleanupFailed ||
          results.some(
            (result) =>
              result.status === "rejected" &&
              result.reason instanceof DockerExecutorError &&
              result.reason.code === "CLEANUP_UNCERTAIN",
          )
        ) {
          throw new DockerExecutorError({
            code: "CLEANUP_UNCERTAIN",
            message: "Executor shutdown includes unresolved job cleanup.",
          });
        }
      } finally {
        owners.delete(ownerKey);
        await removeClientDirectory(directory);
      }
    })());
  return { limits: Object.freeze({ ...config.limits }), reconciledContainers, run, close };
}
