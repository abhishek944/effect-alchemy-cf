import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DockerExecutorError,
  type DockerExecutor,
  type DockerExecutionResult,
} from "@starter/office-server/executor";

function failure(error: unknown) {
  return error instanceof DockerExecutorError
    ? {
        tag: "DockerExecutorError",
        code: error.code,
        message: error.message,
        containerName: error.containerName,
      }
    : { tag: "UnexpectedVerificationFailure" };
}

/** Preserve execution failure identity even when scoped shutdown also reports uncertainty. */
export async function captureFoundationRun(
  runner: DockerExecutor,
  artifacts: string,
): Promise<DockerExecutionResult> {
  const [execution] = await Promise.allSettled([runner.run(new Uint8Array())]);
  const [closed] = await Promise.allSettled([runner.close()]);
  if (execution?.status !== "fulfilled" || closed?.status !== "fulfilled") {
    await writeFile(
      join(artifacts, "native-failure.json"),
      JSON.stringify(
        {
          execution:
            execution?.status === "rejected"
              ? failure(execution.reason)
              : { status: execution?.status },
          shutdown:
            closed?.status === "rejected" ? failure(closed.reason) : { status: closed?.status },
        },
        null,
        2,
      ),
    );
    if (execution?.status === "rejected") throw execution.reason;
    if (closed?.status === "rejected") throw closed.reason;
    throw new Error("Native verification lifecycle did not settle.");
  }
  return execution.value;
}
