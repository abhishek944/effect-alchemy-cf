import { spawn } from "node:child_process";
import { Schema } from "effect";
import { DockerExecutorError, type ResolvedDockerConfig } from "./types.ts";

export const OWNER_LABEL = "io.starter.office.executor.owner";
export const MANAGED_LABEL = "io.starter.office.executor.version";
export const CONTAINER_NAME = /^office-job-[a-f0-9-]{36}$/u;
const ID = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const parseId = Schema.decodeUnknownSync(ID);

export interface DockerClient {
  readonly config: ResolvedDockerConfig;
  readonly directory: string;
  readonly arguments: readonly string[];
  call(args: readonly string[]): Promise<{ code: number; stdout: string }>;
  remove(identity: string, name: string): Promise<void>;
  exitCode(identity: string): Promise<number>;
  reconcile(): Promise<readonly string[]>;
}

/** Separate bounded administrative adapter. No inherited env, shell or Docker credential/context config. */
export function createDockerClient(config: ResolvedDockerConfig, directory: string): DockerClient {
  const prefix = ["--config", directory, "--host", `unix://${config.socketPath}`];
  const call: DockerClient["call"] = (args) =>
    new Promise<{ code: number; stdout: string }>((resolve, reject) => {
      const child = spawn(config.dockerPath, [...prefix, ...args], {
        cwd: directory,
        env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
        shell: false,
        detached: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let settled = false;
      let bytes = 0;
      const chunks: Buffer[] = [];
      const finish = (error?: DockerExecutorError, code?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          child.kill("SIGKILL");
          reject(error);
        } else resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") });
      };
      const uncertain = () =>
        finish(
          new DockerExecutorError({
            code: "CONTROL_UNCERTAIN",
            message: "Docker control command did not complete within its bounded channel.",
          }),
        );
      const timer = setTimeout(uncertain, config.limits.controlTimeMs);
      const collect = (chunk: Buffer, retain: boolean) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) uncertain();
        else if (!settled && retain) chunks.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
      child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
      child.stdout.once("error", uncertain);
      child.stderr.once("error", uncertain);
      child.once("error", () =>
        finish(
          new DockerExecutorError({
            code: "DOCKER_CONTROL_FAILED",
            message: "Docker control process could not start.",
          }),
        ),
      );
      child.once("close", (code) => (code === null ? uncertain() : finish(undefined, code)));
    }).catch((error: unknown) => {
      if (error instanceof DockerExecutorError) throw error;
      throw new DockerExecutorError({
        code: "DOCKER_CONTROL_FAILED",
        message: "Docker control process failed.",
      });
    });
  const requireSuccess = async (args: readonly string[]) => {
    const result = await call(args);
    if (result.code !== 0)
      throw new DockerExecutorError({
        code: "DOCKER_CONTROL_FAILED",
        message: "Docker control command failed.",
      });
    return result.stdout.trim();
  };
  const remove: DockerClient["remove"] = async (identity, name) => {
    try {
      await call(["container", "rm", "--force", identity]);
      const remaining = await requireSuccess([
        "container",
        "ls",
        "--all",
        "--no-trunc",
        "--filter",
        /^[a-f0-9]{64}$/u.test(identity) ? `id=${identity}` : `name=^/${name}$`,
        "--format",
        "{{.ID}}",
      ]);
      if (remaining.length !== 0) throw new Error("Container remains.");
    } catch {
      throw new DockerExecutorError({
        code: "CLEANUP_UNCERTAIN",
        message: "Could not confirm daemon-side container removal.",
        containerName: name,
      });
    }
  };
  const reconcile: DockerClient["reconcile"] = async () => {
    const output = await requireSuccess([
      "container",
      "ls",
      "--all",
      "--no-trunc",
      "--filter",
      `label=${OWNER_LABEL}=${config.owner}`,
      "--filter",
      `label=${MANAGED_LABEL}=1`,
      "--format",
      "{{.ID}} {{.Names}}",
    ]);
    const rows = output.length === 0 ? [] : output.split("\n");
    if (rows.length > 128)
      throw new DockerExecutorError({
        code: "CLEANUP_UNCERTAIN",
        message: "Owned orphan count exceeds the reconciliation budget.",
      });
    const entries = rows.map((row) => {
      const [identity, name, extra] = row.split(" ");
      try {
        if (name === undefined || extra !== undefined || !CONTAINER_NAME.test(name))
          throw new Error("Invalid name.");
        return { identity: parseId(identity), name };
      } catch {
        throw new DockerExecutorError({
          code: "CLEANUP_UNCERTAIN",
          message: "Invalid owned container listing.",
        });
      }
    });
    for (const entry of entries) await remove(entry.identity, entry.name);
    return entries.map((entry) => entry.name);
  };
  const exitCode: DockerClient["exitCode"] = async (identity) => {
    const state = await requireSuccess([
      "container",
      "inspect",
      identity,
      "--format",
      "{{.State.Status}} {{.State.ExitCode}}",
    ]);
    const match = /^exited ([0-9]{1,3})$/u.exec(state);
    if (match?.[1] === undefined || Number(match[1]) > 255)
      throw new DockerExecutorError({
        code: "DOCKER_CONTROL_FAILED",
        message: "Docker did not confirm an exited container.",
      });
    return Number(match[1]);
  };
  return { config, directory, arguments: prefix, call, remove, exitCode, reconcile };
}

export async function verifyDockerImage(client: DockerClient): Promise<void> {
  const result = await client.call([
    "image",
    "inspect",
    client.config.imageId,
    "--format",
    "{{.Id}}",
  ]);
  if (result.code !== 0 || result.stdout.trim() !== client.config.imageId) {
    throw new DockerExecutorError({
      code: "IMAGE_MISMATCH",
      message: "Pinned local Docker image is unavailable.",
    });
  }
  const volumes = await client.call([
    "image",
    "inspect",
    client.config.imageId,
    "--format",
    "{{json .Config.Volumes}}",
  ]);
  if (volumes.code !== 0 || !["null", "{}"].includes(volumes.stdout.trim())) {
    throw new DockerExecutorError({
      code: "INVALID_CONFIG",
      message: "Executor images must not declare host-backed volumes.",
    });
  }
}
