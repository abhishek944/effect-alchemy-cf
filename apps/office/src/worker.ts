import { runOfficeJob } from "@starter/office-server/job-worker";

// Fixed executable for a fresh isolated placement; no host, storage or session config is read.
async function runWorker(): Promise<void> {
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
  const result = await runOfficeJob(Buffer.concat(chunks, size), {
    renderPageRoot: "/opt/office/render-page",
    browserExecutablePath: "/usr/bin/chromium",
  });
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(result, (error) => (error ? reject(error) : resolve())),
  );
}
runWorker().catch(() => {
  process.stderr.write("Office isolated job failed.\n");
  process.exitCode = 1;
});
