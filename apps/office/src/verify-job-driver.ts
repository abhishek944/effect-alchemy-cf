import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createDockerExecutor,
  type DockerExecutionResult,
  type DockerExecutor,
} from "@starter/office-server/executor";

/** Probe-only output/owner namespace. Never an application job input or production API. */
export function jobVerificationDirectory(): string {
  const name = process.argv[2];
  if (name !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(name))
    throw new Error("Expected a bounded owned verification directory name.");
  return join(process.cwd(), "var/office/jobs-details", name ?? ".");
}
type Verification = {
  readonly host: DockerExecutor;
  readonly worker: DockerExecutor;
  readonly workerImage: string;
  readonly acceptanceImage: string;
  readonly checked: (name: string, run: Promise<DockerExecutionResult>) => Promise<Uint8Array>;
};
export async function withJobVerification<A>(
  directory: string,
  work: (input: Verification) => Promise<A>,
): Promise<A> {
  const docker = "/usr/local/bin/docker",
    socket = "/var/run/docker.sock";
  const image = async (tag: string) => {
    const result = await promisify(execFile)(docker, [
      "--host",
      `unix://${socket}`,
      "image",
      "inspect",
      "--platform",
      "linux/amd64",
      tag,
      "--format",
      "{{.Id}}",
    ]);
    const id = result.stdout.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error("Invalid image identity.");
    return id;
  };
  const workerImage = await image("office-native-jobs:local"),
    acceptanceImage = await image("office-native-job-acceptance:local");
  const runner = (imageId: string, owner: string) =>
    createDockerExecutor({
      dockerPath: docker,
      socketPath: socket,
      imageId,
      owner,
      limits: {
        controlTimeMs: 15000,
        wallTimeMs: 120000,
        memoryMiB: 4096,
        cpus: 4,
        pids: 512,
        tmpfsMiB: 256,
        maxInputBytes: 64 * 1024 * 1024,
        maxStdoutBytes: 32 * 1024 * 1024,
        maxStderrBytes: 1024 * 1024,
      },
    });
  const checked = async (name: string, running: Promise<DockerExecutionResult>) => {
    const result = await running;
    await writeFile(join(directory, `${name}.stderr.log`), result.stderr);
    await writeFile(
      join(directory, `${name}.status.json`),
      JSON.stringify({ ...result, stdout: undefined, stderr: undefined }),
    );
    if (result.status !== "exited" || result.exitCode !== 0 || result.cleanup !== "confirmed")
      throw new Error(`Actual isolated ${name} failed.`);
    return result.stdout;
  };
  const namespace = `office-t19-${createHash("sha256").update(directory).digest("hex").slice(0, 12)}`;
  const host = await runner(acceptanceImage, `${namespace}-harness`);
  let worker: DockerExecutor | undefined, outcome: { value: A } | undefined;
  const errors: unknown[] = [];
  try {
    worker = await runner(workerImage, `${namespace}-worker`);
    outcome = { value: await work({ host, worker, workerImage, acceptanceImage, checked }) };
  } catch (error) {
    errors.push(error);
  }
  for (const resource of [worker, host]) {
    try {
      await resource?.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Native job run/cleanup outcomes retained.");
  if (!outcome) throw new Error("Native job verification produced no outcome.");
  return outcome.value;
}
