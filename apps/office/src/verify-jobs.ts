import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { Kind, decodeWireSync } from "@starter/office-contract";
import { decodeNativeFrame, encodeNativeFrame } from "@starter/office-contract/native-wire";
import type { IsolatedJob } from "@starter/office-server/ports";
import { SnapshotWithBlocksSchema } from "../../../packages/office-server/src/jobs/snapshot-schema.ts";
import { encodeJobRequest } from "../../../packages/office-server/src/jobs/transport.ts";
import {
  validateJobOutput,
  ImportedOutputSchema,
  RenderOutputSchema,
} from "../../../packages/office-server/src/jobs/output.ts";
import { executionInput, hash, readInput } from "./verify-job-input.ts";
import { jobVerificationDirectory, withJobVerification } from "./verify-job-driver.ts";
import { checkHostileCandidates } from "./verify-job-hostile.ts";

const directory = jobVerificationDirectory();
await mkdir(directory, { recursive: true });
const checks: unknown[] = [];
await withJobVerification(
  directory,
  async ({ host, worker, workerImage, acceptanceImage, checked }) => {
    const rawSeeds = await checked("seeds", host.run(new Uint8Array()));
    await writeFile(join(directory, "seeds.bin"), rawSeeds);
    const seedPayload = decodeNativeFrame(rawSeeds, "job-output").payload;
    const { seeds, provenance } = decodeWireSync(
      Schema.Struct({
        provenance: Schema.Unknown,
        seeds: Schema.Array(
          Schema.Struct({
            kind: Kind,
            source: Schema.Uint8Array,
            native: SnapshotWithBlocksSchema,
          }),
        ),
      }),
    )(seedPayload);
    await writeFile(join(directory, "image-provenance.json"), JSON.stringify(provenance, null, 2));
    if (seeds.length !== 3) throw new Error("Missing actual native seed types.");
    for (const seed of seeds) {
      const request = executionInput(seed.kind, seed.native, workerImage);
      const binding = request.job.binding;
      const importOptions =
        seed.kind === "sheet"
          ? { kind: "sheet" as const, format: "xlsx" as const, calculate: "no" as const }
          : seed.kind === "doc"
            ? {
                kind: "doc" as const,
                format: "docx" as const,
                compatibility: "traditional" as const,
              }
            : { kind: "slide" as const, format: "pptx" as const };
      const imported: IsolatedJob = {
        kind: "import",
        binding: {
          ...binding,
          jobId: hash(new TextEncoder().encode(`${binding.jobId}-import`)),
          baseRevision: null,
          generation: null,
          codeDigest: null,
          inputDigest: hash(seed.source),
        },
        filename: `seed.${importOptions.format}`,
        options: importOptions,
        input: {
          id: hash(seed.source),
          kind: "upload",
          digest: hash(seed.source),
          bytes: seed.source.byteLength,
          mediaType: "application/octet-stream",
        },
      };
      const importWire = await checked(
        `${seed.kind}-import`,
        worker.run(encodeJobRequest({ job: imported, input: seed.source, code: new Uint8Array() })),
      );
      validateJobOutput(imported, importWire);
      const candidate = await checked(
        `${seed.kind}-execute`,
        worker.run(encodeJobRequest(request)),
      );
      validateJobOutput(request.job, candidate);
      await writeFile(join(directory, `${seed.kind}-candidate.bin`), candidate);
      if (seed.kind === "sheet")
        await checkHostileCandidates(directory, host, request.job, request.input, candidate);
      const validated = await checked(
        `${seed.kind}-validate`,
        host.run(
          encodeNativeFrame("job-input", {
            job: request.job,
            input: request.input,
            candidate,
          }),
        ),
      );
      await writeFile(join(directory, `${seed.kind}-validated.bin`), validated);
      const post = decodeWireSync(
        Schema.Struct({ proposal: Schema.Unknown, native: SnapshotWithBlocksSchema }),
      )(decodeNativeFrame(validated, "job-output").payload);
      const read = readInput(binding, post.native, "inspect");
      const inspectJob: IsolatedJob = {
        kind: "inspect",
        binding: read.binding,
        input: read.input,
        viewId: hash(new TextEncoder().encode(`${binding.jobId}-view`)),
        query: {
          kind:
            seed.kind === "sheet" ? "workbook" : seed.kind === "doc" ? "document" : "presentation",
        },
      };
      const inspected = await checked(
        `${seed.kind}-inspect`,
        worker.run(
          encodeJobRequest({ job: inspectJob, input: read.bytes, code: new Uint8Array() }),
        ),
      );
      validateJobOutput(inspectJob, inspected);
      await writeFile(join(directory, `${seed.kind}-inspection.bin`), inspected);
      const rendered = readInput(binding, post.native, "render");
      const slideData =
        post.native.snapshot.slide === undefined
          ? undefined
          : Schema.decodeUnknownSync(Schema.Struct({ slideOrder: Schema.Array(Schema.String) }))(
              JSON.parse(new TextDecoder().decode(post.native.snapshot.slide.originalMeta)),
            );
      const sheetId = post.native.snapshot.workbook?.sheetOrder[0],
        slideId = slideData?.slideOrder[0];
      const renderJob: IsolatedJob = {
        kind: "render",
        binding: rendered.binding,
        input: rendered.input,
        selection:
          seed.kind === "sheet" && sheetId
            ? { kind: "sheet", worksheetId: sheetId, range: "A1:B3" }
            : seed.kind === "doc"
              ? { kind: "doc", pages: [1] }
              : slideId
                ? { kind: "slide", pages: [slideId] }
                : (() => {
                    throw new Error("Missing native page identity.");
                  })(),
      };
      const renderWire = await checked(
        `${seed.kind}-render`,
        worker.run(
          encodeJobRequest({ job: renderJob, input: rendered.bytes, code: new Uint8Array() }),
        ),
      );
      const output = validateJobOutput(renderJob, renderWire);
      if (output.mediaType !== "image/png") throw new Error("Expected a single actual PNG.");
      await writeFile(join(directory, `${seed.kind}-job.png`), output.bytes);
      const exported = readInput(binding, post.native, "export");
      const exportJob: IsolatedJob = {
        kind: "export",
        binding: exported.binding,
        input: exported.input,
        options:
          seed.kind === "sheet"
            ? { kind: "sheet", format: "xlsx" }
            : seed.kind === "doc"
              ? { kind: "doc", format: "docx" }
              : { kind: "slide", format: "pptx" },
      };
      const exportWire = await checked(
        `${seed.kind}-export`,
        worker.run(
          encodeJobRequest({ job: exportJob, input: exported.bytes, code: new Uint8Array() }),
        ),
      );
      const file = validateJobOutput(exportJob, exportWire);
      await writeFile(join(directory, `edited.${exportJob.options.format}`), file.bytes);
      const pixels = decodeWireSync(RenderOutputSchema)(
        decodeNativeFrame(renderWire, "job-output").payload,
      ).images[0];
      const nativeImport = decodeWireSync(ImportedOutputSchema)(
        decodeNativeFrame(importWire, "job-output").payload,
      );
      checks.push({
        kind: seed.kind,
        importedBlocks: nativeImport.native.sheetBlocks.length,
        png: { sha256: hash(output.bytes), width: pixels?.width, height: pixels?.height },
        exportBytes: file.bytes.byteLength,
        revision: post.native.snapshot.rev,
      });
    }
    await writeFile(
      join(directory, "native-acceptance.json"),
      JSON.stringify({ workerImage, acceptanceImage, checks }, null, 2),
    );
    console.log(JSON.stringify({ workerImage, acceptanceImage, checks }));
  },
);
