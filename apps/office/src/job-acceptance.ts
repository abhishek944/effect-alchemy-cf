import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import { decodeNativeFrame, encodeNativeFrame } from "@starter/office-contract/native-wire";
import {
  decodeJobInput,
  decodeMutationCandidate,
  validateMutationCandidate,
} from "@starter/office-server/jobs";
import { UnitSnapshotMaterializer } from "@univerjs-pro/collaboration-service";
import {
  exportToBuffer,
  importBufferToSnapshot,
  ExchangeFormat,
  FormulaCalculationMode,
} from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import { createDocSample, createSheetSample, createSlideSample } from "./foundation-samples.ts";
import { IsolatedJobSchema } from "../../../packages/office-server/src/jobs/schemas.ts";

// Fixed synthetic acceptance fixture, never an application job command or a storage adapter.
async function seeds() {
  const units = [await createSheetSample(), await createDocSample(), await createSlideSample()];
  const result = [];
  for (const unit of units) {
    const common = {
      unitId: unit.unitData.id,
      fileName: `seed.${unit.unitType === "sheet" ? "xlsx" : unit.unitType === "doc" ? "docx" : "pptx"}`,
    };
    if (unit.unitType === "sheet") {
      const source = await exportToBuffer(unit.unitData, {
        type: UniverInstanceType.UNIVER_SHEET,
        format: ExchangeFormat.XLSX,
        formulaCalculation: FormulaCalculationMode.NO,
      });
      result.push({
        kind: unit.unitType,
        source,
        native: await importBufferToSnapshot(source, {
          ...common,
          type: UniverInstanceType.UNIVER_SHEET,
          format: ExchangeFormat.XLSX,
          formulaCalculation: FormulaCalculationMode.NO,
        }),
      });
    } else if (unit.unitType === "doc") {
      const source = await exportToBuffer(unit.unitData, {
        type: UniverInstanceType.UNIVER_DOC,
        format: ExchangeFormat.DOCX,
      });
      result.push({
        kind: unit.unitType,
        source,
        native: await importBufferToSnapshot(source, {
          ...common,
          type: UniverInstanceType.UNIVER_DOC,
          format: ExchangeFormat.DOCX,
        }),
      });
    } else {
      const source = await exportToBuffer(unit.unitData, {
        type: UniverInstanceType.UNIVER_SLIDE,
        format: ExchangeFormat.PPTX,
      });
      result.push({
        kind: unit.unitType,
        source,
        native: await importBufferToSnapshot(source, {
          ...common,
          type: UniverInstanceType.UNIVER_SLIDE,
          format: ExchangeFormat.PPTX,
        }),
      });
    }
  }
  const provenance: unknown = JSON.parse(await readFile("/opt/office/provenance.json", "utf8"));
  return encodeNativeFrame("job-output", { seeds: result, provenance });
}
async function run(): Promise<void> {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Linux/amd64 required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const stream: AsyncIterable<unknown> = process.stdin;
  for await (const part of stream) {
    if (!(part instanceof Uint8Array)) throw new Error("Invalid fixture input.");
    size += part.byteLength;
    if (size > 34 * 1024 * 1024) throw new Error("Fixture input limit.");
    chunks.push(part);
  }
  let output: Uint8Array;
  if (size === 0) output = await seeds();
  else {
    const request = decodeWireSync(
      Schema.Struct({
        job: IsolatedJobSchema,
        input: Schema.Uint8Array,
        candidate: Schema.Uint8Array,
      }),
    )(decodeNativeFrame(Buffer.concat(chunks, size), "job-input").payload);
    if (request.job.kind !== "execute") throw new Error("Execution fixture required.");
    const input = decodeJobInput(request.input, request.job.binding);
    const candidate = decodeMutationCandidate(request.candidate, request.job.binding);
    const proposal = await validateMutationCandidate(input, candidate, {
      userId: "disposable-job-owner",
      memberId: "job-verifier",
      sid: request.job.binding.jobId,
      reqId: 1,
    });
    const materializer = new UnitSnapshotMaterializer();
    try {
      const native = await materializer.materializeSnapshot({
        ...input.native,
        changesets: [proposal.changeset],
        targetRevision: proposal.changeset.revision,
      });
      output = encodeNativeFrame("job-output", { proposal, native });
    } finally {
      await materializer.dispose();
    }
  }
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(output, (error) => (error ? reject(error) : resolve())),
  );
}
run().catch((error) => {
  // Synthetic fixture errors only; ordinary job worker never logs foreign exceptions.
  process.stderr.write(`${error instanceof Error ? error.message : "Fixture failure"}\n`);
  process.exitCode = 1;
});
