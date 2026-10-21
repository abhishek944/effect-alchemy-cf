import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { Kind, decodeWireSync } from "@starter/office-contract";
import { decodeNativeFrame, encodeNativeFrame } from "@starter/office-contract/native-wire";
import { SnapshotWithBlocksSchema } from "../../../packages/office-server/src/jobs/snapshot-schema.ts";
import { encodeJobRequest } from "../../../packages/office-server/src/jobs/transport.ts";
import { validateJobOutput } from "../../../packages/office-server/src/jobs/output.ts";
import { executionInput, hash } from "./verify-job-input.ts";
import { jobVerificationDirectory, withJobVerification } from "./verify-job-driver.ts";

const folder = jobVerificationDirectory();
const { seeds } = decodeWireSync(
  Schema.Struct({
    provenance: Schema.optional(Schema.Unknown),
    seeds: Schema.Array(
      Schema.Struct({
        kind: Kind,
        source: Schema.Uint8Array,
        native: SnapshotWithBlocksSchema,
      }),
    ),
  }),
)(decodeNativeFrame(await readFile(join(folder, "seeds.bin")), "job-output").payload);
const seed = seeds.find((value) => value.kind === "sheet");
if (!seed) throw new Error("Missing actual native seed.");
const sentinel = join(folder, "host-only-sentinel.txt");
await writeFile(sentinel, "Disposable public isolation sentinel; not mounted into native jobs.");
await withJobVerification(folder, async ({ worker, workerImage, checked }) => {
  const base = executionInput("sheet", seed.native, workerImage);
  const request = (source: string) => {
    const code = new TextEncoder().encode(source),
      id = hash(code);
    const binding = { ...base.job.binding, jobId: id, operationId: id, codeDigest: hash(code) };
    const input = encodeNativeFrame("job-input", { binding, native: seed.native });
    const job = {
      ...base.job,
      binding,
      input: { ...base.job.input, id: hash(input), digest: hash(input), bytes: input.byteLength },
      code: { ...base.job.code, id: hash(code), digest: hash(code), bytes: code.byteLength },
    };
    return { job, input, code };
  };
  const isolated = request(`
const fs = await import("node:fs/promises");
let denied = 0;
for (const action of [
 () => fs.readFile(${JSON.stringify(sentinel)}),
 () => fs.readFile("/var/run/docker.sock"),
 () => fs.writeFile("/opt/office/forbidden-write", "not allowed"),
 () => fetch("https://example.com", { signal: AbortSignal.timeout(500) })
]) { try { await action(); } catch { denied++; } }
if (denied !== 4) throw new Error("Outer isolation did not deny an access");
if (["OPENAI_API_KEY", "CLOUDFLARE_API_TOKEN", "OFFICE_TASK_TOKEN", "BETTER_AUTH_SECRET"].some(key => process.env[key] !== undefined))
 throw new Error("Unexpected credential in job process");
workbook.getActiveSheet().getRange("B2").setValue("T19 isolated");
`);
  const native = await checked("isolation-access", worker.run(encodeJobRequest(isolated)));
  validateJobOutput(isolated.job, native);
  const malicious = request('process.stdout.write("NOT_A_NATIVE_FRAME"); process.exit(0);');
  const forged = await checked("hostile-stdout", worker.run(encodeJobRequest(malicious)));
  let rejected = false;
  try {
    validateJobOutput(malicious.job, forged);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Untrusted process stdout became a valid native result.");
  const oversized = request("process.stdout.write(Buffer.alloc(33 * 1024 * 1024));");
  const bounded = await worker.run(encodeJobRequest(oversized));
  await writeFile(
    join(folder, "output-limit.status.json"),
    JSON.stringify({ ...bounded, stdout: undefined, stderr: undefined }),
  );
  if (
    bounded.status !== "output-limit" ||
    bounded.cleanup !== "confirmed" ||
    bounded.stdoutBytes <= 32 * 1024 * 1024 ||
    bounded.stdout.byteLength !== 0
  )
    throw new Error("Actual generated stdout did not enforce its finite output bound.");
  await writeFile(
    join(folder, "isolation-acceptance.json"),
    JSON.stringify({
      workerImage,
      actualGeneratedCode: true,
      deniedHostSentinel: true,
      deniedSocket: true,
      deniedReadonlyRoot: true,
      deniedInternet: true,
      credentialsAbsent: true,
      maliciousExitZeroStdoutRejected: true,
      actualGeneratedStdoutLimit: true,
    }),
  );
});
console.log("Actual credential-free/no-egress job accesses and hostile stdout checks passed.");
