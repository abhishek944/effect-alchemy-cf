import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeNativeFrame, encodeNativeFrame } from "@starter/office-contract/native-wire";
import { Schema } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import type { DockerExecutor } from "@starter/office-server/executor";
import type { IsolatedJob } from "@starter/office-server/ports";
import { MutationCandidateSchema } from "../../../packages/office-server/src/jobs/schemas.ts";

/** Actual clean SDK/outer-process rejection checks using only synthetic captured candidates. */
export async function checkHostileCandidates(
  directory: string,
  host: DockerExecutor,
  job: Extract<IsolatedJob, { kind: "execute" }>,
  input: Uint8Array,
  wire: Uint8Array,
) {
  const candidate = decodeWireSync(MutationCandidateSchema)(
    decodeNativeFrame(wire, "job-output").payload,
  );
  const [first] = candidate.mutations;
  if (!first) throw new Error("Actual mutable candidate required.");
  const params = decodeWireSync(Schema.Record(Schema.String, Schema.Unknown))(
    JSON.parse(first.data),
  );
  const malformed = [
    {
      name: "foreign-binding",
      value: { ...candidate, binding: { ...candidate.binding, jobId: "f".repeat(64) } },
    },
    {
      name: "foreign-unit",
      value: {
        ...candidate,
        mutations: [{ ...first, data: JSON.stringify({ ...params, unitId: "foreign-unit" }) }],
      },
    },
    {
      name: "foreign-subunit",
      value: {
        ...candidate,
        mutations: [{ ...first, data: JSON.stringify({ ...params, subUnitId: "foreign-sheet" }) }],
      },
    },
    {
      name: "lifecycle-command",
      value: {
        ...candidate,
        mutations: [{ id: "sheet.mutation.remove-sheet", data: JSON.stringify(params) }],
      },
    },
    {
      name: "forged-authority",
      value: { ...candidate, sid: "job-supplied-authority", userID: "other-owner" },
    },
  ];
  const checks = [];
  for (const test of malformed) {
    const result = await host.run(
      encodeNativeFrame("job-input", {
        job,
        input,
        candidate: encodeNativeFrame("job-output", test.value),
      }),
    );
    await writeFile(
      join(directory, `hostile-${test.name}.status.json`),
      JSON.stringify({
        status: result.status,
        exitCode: result.exitCode,
        cleanup: result.cleanup,
        containerName: result.containerName,
        stderrBytes: result.stderrBytes,
      }),
    );
    if (result.status !== "exited" || result.exitCode === 0 || result.cleanup !== "confirmed")
      throw new Error(`Actual clean SDK rejection did not hold: ${test.name}`);
    checks.push(test.name);
  }
  await writeFile(
    join(directory, "hostile-acceptance.json"),
    JSON.stringify({ checks, actualLinuxIsolated: true }),
  );
}
