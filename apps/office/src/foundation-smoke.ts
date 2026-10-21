import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createOfficeRenderer } from "@starter/office-server/jobs";
import { Schema } from "effect";
import { ExchangeFormat, importBufferToSnapshot } from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import { createDocSample, createSheetSample, createSlideSample } from "./foundation-samples.ts";

// Fixed artifact acceptance, not an application job/CLI protocol. No generated source is accepted.
console.log = (...values: unknown[]) => console.error(...values);
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Linux/amd64 runtime is required.");
const provenance: unknown = JSON.parse(await readFile("/opt/office/provenance.json", "utf8"));
if (
  Schema.decodeUnknownSync(Schema.Struct({ sdkVersion: Schema.String }))(provenance).sdkVersion !==
  "1.0.3"
)
  throw new Error("SDK image cohort mismatch.");
const started = Date.now();
const snapshot = await importBufferToSnapshot(Buffer.from("Name,Value\nNative,42\n"), {
  type: UniverInstanceType.UNIVER_SHEET,
  format: ExchangeFormat.CSV,
  fileName: "foundation.csv",
  unitId: "foundation-exchange",
});
if (snapshot.sheetBlocks.length === 0)
  throw new Error("Native Linux Exchange produced no Sheet blocks.");
const units = [await createSheetSample(), await createDocSample(), await createSlideSample()];
console.error(
  "Native Office initialized:",
  units.map((unit) => unit.unitType).join(","),
  "Exchange blocks:",
  snapshot.sheetBlocks.length,
);
const renderer = await createOfficeRenderer({
  renderPageRoot: "/opt/office/render-page",
  browserExecutablePath: "/usr/bin/chromium",
});
const images: {
  unitType: string;
  name: string;
  width: number;
  height: number;
  sha256: string;
  png: string;
}[] = [];
try {
  for (const unit of units) {
    console.error("Native Office capture:", unit.unitType);
    const result =
      unit.unitType === "sheet"
        ? await renderer.screenshots.capture({
            ...unit,
            target: { kind: "sheet-range", range: "A1:B3", scale: 1 },
          })
        : unit.unitType === "doc"
          ? await renderer.screenshots.capture({
              ...unit,
              target: { kind: "doc-pages", pages: [1], scale: 1 },
            })
          : await renderer.screenshots.capture({
              ...unit,
              target: { kind: "slide-pages", pages: [1], scale: 1 },
            });
    for (const image of result.images) {
      if (
        image.bytes.length < 24 ||
        Buffer.from(image.bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a"
      ) {
        throw new Error("Native renderer did not produce a PNG.");
      }
      images.push({
        unitType: unit.unitType,
        name: image.name,
        width: image.width,
        height: image.height,
        sha256: createHash("sha256").update(image.bytes).digest("hex"),
        png: Buffer.from(image.bytes).toString("base64"),
      });
    }
  }
} finally {
  await renderer.close();
}
if (new Set(images.map((image) => image.unitType)).size !== 3)
  throw new Error("Missing native Office image.");
const resources = {
  memoryPeakBytes: (await readFile("/sys/fs/cgroup/memory.peak", "utf8")).trim(),
  memoryMaxBytes: (await readFile("/sys/fs/cgroup/memory.max", "utf8")).trim(),
  cpuQuota: (await readFile("/sys/fs/cgroup/cpu.max", "utf8")).trim(),
  pidsMax: (await readFile("/sys/fs/cgroup/pids.max", "utf8")).trim(),
  nodeRssBytes: process.memoryUsage().rss,
};
process.stdout.write(
  JSON.stringify({
    sdkVersion: "1.0.3",
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    nativeExchangeBlocks: snapshot.sheetBlocks.length,
    nativeTypes: units.map((unit) => unit.unitType),
    elapsedMs: Date.now() - started,
    resources,
    images,
    provenance,
  }),
);
