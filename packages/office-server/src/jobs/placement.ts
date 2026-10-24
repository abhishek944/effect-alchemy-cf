import { jobDiagnostics } from "@starter/office-contract";
import { reportFailure } from "@starter/diagnostics";
import { decodeJobRequest } from "./transport.ts";
import {
  createDockerExecutor,
  type DockerExecutorConfig,
  type DockerExecutionResult,
} from "../executor/index.ts";

export type FreshJobOutcome = Pick<
  DockerExecutionResult,
  "status" | "exitCode" | "stdout" | "cleanup"
>;
/**
 * Operator capability, NEVER model input. Each call creates a fresh credential-free/no-egress
 * placement with the immutable image's fixed worker entrypoint and hard resource/teardown bounds.
 * Production supplies real separate job placement; a warm-host RPC or nested Docker is not valid.
 * The implementation owns proving its provider's actual isolation and cleanup controls.
 */
export interface FreshJobPlacement {
  readonly imageDigest: string;
  run(input: Uint8Array, signal: AbortSignal): Promise<FreshJobOutcome>;
}
/** Owns the actual image/config association. The caller must await close at supervisor shutdown. */
export async function createLocalJobPlacement(config: DockerExecutorConfig): Promise<
  FreshJobPlacement & {
    close(): Promise<void>;
  }
> {
  const executor = await createDockerExecutor(config);
  if (
    executor.limits.maxInputBytes < 34 * 1024 * 1024 ||
    executor.limits.maxStdoutBytes < 16 * 1024 * 1024
  ) {
    await executor.close();
    throw new RangeError("The local executor does not meet the native job byte profile.");
  }
  return {
    imageDigest: config.imageId,
    run: async (input, signal) => {
      const { job } = decodeJobRequest(input);
      const result = await executor.run(input, signal);
      const binding = { operationId: job.binding.operationId, taskId: job.binding.jobId };
      const relay = jobDiagnostics(undefined, binding);
      const records = relay.write(result.stderr);
      const { discarded } = relay.finish();
      for (const record of records) console.error(JSON.stringify(record));
      if (discarded)
        reportFailure(undefined, {
          component: "office.job-supervisor",
          operation: "stderr",
          reason: "unstructured-diagnostic",
          ...binding,
        });
      return result;
    },
    close: () => executor.close(),
  };
}
