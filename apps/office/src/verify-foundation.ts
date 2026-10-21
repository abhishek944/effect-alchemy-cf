import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { Schema } from "effect";
import { createDockerExecutor } from "@starter/office-server/executor";
import { captureFoundationRun } from "./verify-run.ts";

const artifactRoot = fileURLToPath(
  new URL("../../../var/office/runtime-image-details", import.meta.url),
);
const execute = promisify(execFile);
const nativeResult = Schema.Struct({
  sdkVersion: Schema.Literal("1.0.3"),
  platform: Schema.Literal("linux/x64"),
  node: Schema.String,
  nativeExchangeBlocks: Schema.Int,
  elapsedMs: Schema.Number,
  resources: Schema.Struct({
    memoryPeakBytes: Schema.String,
    memoryMaxBytes: Schema.String,
    cpuQuota: Schema.String,
    pidsMax: Schema.String,
    nodeRssBytes: Schema.Number,
  }),
  nativeTypes: Schema.Array(Schema.Literals(["sheet", "doc", "slide"])),
  images: Schema.Array(
    Schema.Struct({
      unitType: Schema.Literals(["sheet", "doc", "slide"]),
      name: Schema.String,
      width: Schema.Int,
      height: Schema.Int,
      sha256: Schema.String,
      png: Schema.String,
    }),
  ),
  provenance: Schema.Record(Schema.String, Schema.Unknown),
});

/** Own real native artifact acceptance. No model source, host browser, mock, or application receipt. */
export async function verifyOfficeFoundationImage() {
  await mkdir(artifactRoot, { recursive: true });
  const image = await execute(
    "/usr/local/bin/docker",
    [
      "--host",
      "unix:///var/run/docker.sock",
      "image",
      "inspect",
      "--platform",
      "linux/amd64",
      "office-native-foundation:local",
      "--format",
      "{{.Id}} {{.Os}}/{{.Architecture}}",
    ],
    { env: { PATH: "/usr/local/bin:/usr/bin:/bin" }, timeout: 10000, maxBuffer: 4096 },
  );
  const [imageId, platform] = image.stdout.trim().split(" ");
  if (imageId === undefined || platform !== "linux/amd64")
    throw new Error("Expected own Linux/amd64 foundation image.");
  const limits = {
    controlTimeMs: 15000,
    memoryMiB: 4096,
    cpus: 4,
    pids: 512,
    tmpfsMiB: 256,
    maxStdoutBytes: 8 * 1024 * 1024,
    maxStderrBytes: 1024 * 1024,
    wallTimeMs: 120000,
  };
  const owner = "office-foundation-acceptance";
  await writeFile(
    join(artifactRoot, "native-admission.json"),
    JSON.stringify({ owner, imageId, limits }, null, 2),
  );
  const runner = await createDockerExecutor({
    dockerPath: "/usr/local/bin/docker",
    socketPath: "/var/run/docker.sock",
    imageId,
    owner,
    limits,
  });
  const produced = await captureFoundationRun(runner, artifactRoot);
  await writeFile(join(artifactRoot, "native.stderr.log"), produced.stderr);
  await writeFile(join(artifactRoot, "native.stdout.json"), produced.stdout);
  await writeFile(
    join(artifactRoot, "native-status.json"),
    JSON.stringify(
      {
        imageId,
        imagePlatform: platform,
        limits,
        status: produced.status,
        exitCode: produced.exitCode,
        cleanup: produced.cleanup,
        stdoutBytes: produced.stdoutBytes,
        stderrBytes: produced.stderrBytes,
      },
      null,
      2,
    ),
  );
  if (produced.status !== "exited" || produced.exitCode !== 0) {
    throw new Error(`Native foundation did not complete: ${produced.status}/${produced.exitCode}.`);
  }
  const raw: unknown = JSON.parse(Buffer.from(produced.stdout).toString("utf8"));
  const result = Schema.decodeUnknownSync(nativeResult)(raw);
  if (
    result.nativeExchangeBlocks < 1 ||
    new Set(result.nativeTypes).size !== 3 ||
    result.images.length !== 3
  ) {
    throw new Error("Native foundation did not prove all three Office types.");
  }
  const memoryMaximum = limits.memoryMiB * 1024 * 1024;
  const memoryPeak = Number(result.resources.memoryPeakBytes);
  if (
    result.resources.memoryMaxBytes !== String(memoryMaximum) ||
    result.resources.cpuQuota !== "400000 100000" ||
    result.resources.pidsMax !== "512" ||
    !Number.isSafeInteger(memoryPeak) ||
    memoryPeak < 1 ||
    memoryPeak > memoryMaximum
  ) {
    throw new Error("Actual native resource measurements do not match the bounded image profile.");
  }
  const images = [];
  for (const [index, imageResult] of result.images.entries()) {
    const bytes = Buffer.from(imageResult.png, "base64");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(16) !== imageResult.width ||
      bytes.readUInt32BE(20) !== imageResult.height ||
      imageResult.width < 1 ||
      imageResult.height < 1 ||
      imageResult.width * imageResult.height > 16_000_000 ||
      digest !== imageResult.sha256
    )
      throw new Error("Invalid actual native PNG artifact.");
    const name = `${imageResult.unitType}-${index + 1}.png`;
    await writeFile(join(artifactRoot, name), bytes);
    images.push({
      unitType: imageResult.unitType,
      path: name,
      width: imageResult.width,
      height: imageResult.height,
      sha256: digest,
      bytes: bytes.length,
    });
  }
  const report = {
    imageId,
    imagePlatform: platform,
    limits,
    sdkVersion: result.sdkVersion,
    node: result.node,
    nativePlatform: result.platform,
    elapsedMs: result.elapsedMs,
    resources: result.resources,
    nativeExchangeBlocks: result.nativeExchangeBlocks,
    images,
    provenance: result.provenance,
  };
  await writeFile(join(artifactRoot, "native-result.json"), JSON.stringify(report, null, 2));
  return { imageId, imagePlatform: platform, elapsedMs: result.elapsedMs, images };
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 2)
    throw new Error("Usage: node --experimental-strip-types src/verify-foundation.ts");
  console.log(JSON.stringify(await verifyOfficeFoundationImage()));
}
