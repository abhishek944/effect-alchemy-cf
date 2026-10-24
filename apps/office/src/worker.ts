import { OfficeInvalid } from "@starter/office-contract";
import { diagnosticMetadata, failureRecord, reportFailure } from "@starter/diagnostics";

const context = {
  ...diagnosticMetadata(process.env),
  component: "office.job-entry",
  operation: "run",
};

let jobExecuting = false;
let phase: "input" | "module" | "output" = "input";
// Fixed executable for a fresh isolated placement; stdout is exclusively the binary job result.
const entered = () =>
  console.error(
    JSON.stringify({
      ...failureRecord(undefined, {
        ...context,
        phase,
        event: "application.phase",
      }),
      level: "INFO",
    }),
  );
async function runWorker(): Promise<void> {
  entered();
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Unsupported job platform.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const source: AsyncIterable<unknown> = process.stdin;
  for await (const chunk of source) {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array))
      throw new Error("Invalid job input.");
    const part = Buffer.from(chunk);
    size += part.byteLength;
    if (size > 34 * 1024 * 1024) throw new Error("Job input exceeds its limit.");
    chunks.push(part);
  }
  phase = "module";
  entered();
  // Load native dependencies inside the entry catch, not before diagnostics can run.
  const { runOfficeJob } = await import("@starter/office-server/job-worker");
  jobExecuting = true;
  const result = await runOfficeJob(Buffer.concat(chunks, size), {
    renderPageRoot: "/opt/office/render-page",
    browserExecutablePath: "/usr/bin/chromium",
  });
  jobExecuting = false;
  phase = "output";
  entered();
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(result, (error) => (error ? reject(error) : resolve())),
  );
  console.error(
    JSON.stringify({
      ...failureRecord(undefined, {
        ...context,
        phase,
        event: "application.complete",
        outcome: "confirmed",
        bytes: result.byteLength,
      }),
      level: "INFO",
    }),
  );
}
runWorker().catch((cause: unknown) => {
  // Decoded execution owns its failure; entry owns input, module loading and physical output.
  if (!jobExecuting)
    reportFailure(cause, {
      ...context,
      phase,
      outcome: "unknown",
      reason:
        phase === "input"
          ? "input-read-failed"
          : phase === "module"
            ? "module-load-failed"
            : "result-write-failed",
    });
  process.exitCode = cause instanceof OfficeInvalid ? 2 : 1;
});
