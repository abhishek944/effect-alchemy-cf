import { Data, Schema } from "effect";

export type DockerExecutorErrorCode =
  | "INVALID_CONFIG"
  | "DOCKER_CONTROL_FAILED"
  | "CONTROL_UNCERTAIN"
  | "IMAGE_MISMATCH"
  | "CLEANUP_UNCERTAIN"
  | "EXECUTOR_CLOSED"
  | "CAPACITY_EXCEEDED"
  | "INPUT_LIMIT";

/** No raw Docker/program output is included in errors. Cleanup uncertainty forbids success. */
export class DockerExecutorError extends Data.TaggedError("DockerExecutorError")<{
  readonly code: DockerExecutorErrorCode;
  readonly message: string;
  readonly containerName?: string;
}> {}

export interface DockerLimits {
  readonly wallTimeMs: number;
  readonly controlTimeMs: number;
  readonly maxInputBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly memoryMiB: number;
  readonly cpus: number;
  readonly pids: number;
  readonly tmpfsMiB: number;
  readonly fileDescriptors: number;
  readonly concurrency: number;
}

export const DEFAULT_DOCKER_LIMITS: DockerLimits = Object.freeze({
  wallTimeMs: 120_000,
  controlTimeMs: 10_000,
  maxInputBytes: 64 * 1024 * 1024,
  maxStdoutBytes: 32 * 1024 * 1024,
  maxStderrBytes: 64 * 1024,
  memoryMiB: 1536,
  cpus: 2,
  pids: 128,
  tmpfsMiB: 128,
  fileDescriptors: 1024,
  concurrency: 1,
});

export interface DockerExecutorConfig {
  readonly dockerPath: string;
  readonly socketPath: string;
  readonly imageId: string;
  /** Stable, exclusively owned supervisor namespace; never a model/user-provided value. */
  readonly owner: string;
  readonly limits?: Partial<DockerLimits>;
}

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const absolutePath = Schema.String.check(Schema.isPattern(/^\/(?:[^\0\r\n])+$/u));
const configSchema = Schema.Struct({
  dockerPath: absolutePath,
  socketPath: absolutePath,
  imageId: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u)),
  owner: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,47}$/u)),
  limits: Schema.Struct({
    wallTimeMs: bounded(10, 120_000),
    controlTimeMs: bounded(100, 15_000),
    maxInputBytes: bounded(1, 64 * 1024 * 1024),
    maxStdoutBytes: bounded(1, 32 * 1024 * 1024),
    maxStderrBytes: bounded(1, 1024 * 1024),
    memoryMiB: bounded(64, 4096),
    cpus: bounded(1, 4),
    pids: bounded(16, 512),
    tmpfsMiB: bounded(8, 512),
    fileDescriptors: bounded(64, 4096),
    concurrency: bounded(1, 4),
  }),
});

export type ResolvedDockerConfig = typeof configSchema.Type;
export function resolveDockerConfig(config: DockerExecutorConfig): ResolvedDockerConfig {
  try {
    return Schema.decodeUnknownSync(configSchema)({
      ...config,
      limits: { ...DEFAULT_DOCKER_LIMITS, ...config.limits },
    });
  } catch {
    throw new DockerExecutorError({
      code: "INVALID_CONFIG",
      message: "Invalid Docker executor configuration.",
    });
  }
}

export type DockerExecutionStatus = "exited" | "cancelled" | "timed-out" | "output-limit";
export interface DockerExecutionResult {
  readonly containerName: string;
  readonly status: DockerExecutionStatus;
  readonly exitCode: number | null;
  /** Empty for interrupted/limited jobs. Bytes never assert application commit or protocol validity. */
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly cleanup: "confirmed";
}

export interface DockerExecutor {
  readonly limits: DockerLimits;
  readonly reconciledContainers: readonly string[];
  run(input: Uint8Array, signal?: AbortSignal): Promise<DockerExecutionResult>;
  /** Abort and drain all jobs, awaiting daemon-side removal. Must be awaited in caller finally. */
  close(): Promise<void>;
}
