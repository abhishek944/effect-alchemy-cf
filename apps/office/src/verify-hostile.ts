import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { Kind, decodeWireSync } from "@starter/office-contract";
import { decodeNativeFrame } from "@starter/office-contract/native-wire";
import { SnapshotWithBlocksSchema } from "../../../packages/office-server/src/jobs/snapshot-schema.ts";
import { executionInput } from "./verify-job-input.ts";
import { jobVerificationDirectory, withJobVerification } from "./verify-job-driver.ts";
import { checkHostileCandidates } from "./verify-job-hostile.ts";

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
if (!seed) throw new Error("Missing actual Sheet seed.");
await withJobVerification(folder, async ({ host, workerImage }) => {
  const request = executionInput(seed.kind, seed.native, workerImage);
  await checkHostileCandidates(
    folder,
    host,
    request.job,
    request.input,
    await readFile(join(folder, "sheet-candidate.bin")),
  );
});
console.log("Actual five hostile candidate cases rejected with cleanup confirmed.");
