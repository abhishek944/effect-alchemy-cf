import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { Effect } from "effect";
import { OfficeForbidden, OfficeInvalid, safeFailure } from "@starter/office-contract";
import type { Actor, OfficeService } from "@starter/office-server/ports";
import { downloadBody, incomingBody } from "./native-private-readers.ts";
import type { NativePrivateFile } from "./native-private-wire.ts";

const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
const uploadPath = "/__office/upload";
const downloadPath = "/__office/download";
/** ArtifactRef JSON is well under this; the ACK is bounded rather than copied from provider bytes. */
const ackMaximum = 4096;

async function deny(response: ServerResponse, code: number): Promise<void> {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(code, { "cache-control": "private, no-store" }).end();
  await finished(response).catch(() => undefined);
}

/** Internal HTTP status only; provider detail never crosses to the forwarding Worker. */
function status(error: unknown): number {
  if (error instanceof OfficeForbidden) return 403;
  if (error instanceof OfficeInvalid) return 400;
  return 503;
}

type UploadFile = Extract<NativePrivateFile, { kind: "upload" }>;

async function uploadFile(
  office: OfficeService,
  actor: Actor,
  input: UploadFile,
  request: IncomingMessage,
  response: ServerResponse,
  onCleanupFailure: () => void,
): Promise<void> {
  const source = incomingBody(request);
  try {
    const ref = await Effect.runPromise(
      office.upload(actor, {
        operationId: input.input.operationId,
        kind: input.input.kind,
        filename: input.input.filename,
        declaredBytes: input.input.bytes,
        expectedDigest: input.input.digest,
        body: source.stream,
      }),
    );
    const ack = new TextEncoder().encode(JSON.stringify(ref));
    if (ack.byteLength < 1 || ack.byteLength > ackMaximum) throw forbidden();
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": String(ack.byteLength),
      "cache-control": "private, no-store",
    });
    await finished(response.end(ack));
  } catch (error) {
    // Flush the real work-error response, THEN retire the still-open source. A failed close
    // propagates and destroys the response rather than pretending the request ended cleanly.
    await deny(response, status(error));
    try {
      await source.close();
    } catch (cleanup) {
      onCleanupFailure(); // A rejected real close can never produce a clean /finished report.
      throw cleanup;
    }
    return;
  }
  // Body reached EOF; the frozen listener ABI joins the actual request/response close.
}

async function downloadFile(
  office: OfficeService,
  actor: Actor,
  artifactId: string,
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
  onCleanupFailure: () => void,
): Promise<void> {
  if (request.url !== downloadPath || request.method !== "POST") throw forbidden();
  const value = await Effect.runPromise(office.download(actor, artifactId));
  // Own the ACTUAL reader immediately: every later validation/header/pipeline exit closes it.
  const source = downloadBody(value.body, signal);
  let failed = false;
  let failure: unknown;
  try {
    // The immutable ACK must be the SAME artifact the original private frame selected.
    if (value.ref.id !== artifactId) throw forbidden();
    response.writeHead(200, {
      "content-type": value.ref.mediaType,
      "cache-control": "private, no-store",
    });
    // Abort/destination failure destroys this source, whose close cancels the private reader.
    await pipeline(Readable.from(source.chunks()), response, { signal });
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await source.close();
  } catch (cleanup) {
    // A failed real cleanup is NEVER a clean download, and it poisons the request cleanup even
    // when a work error already selected the response; that work status is still preserved.
    onCleanupFailure();
    if (!failed) throw cleanup;
  }
  if (failed) throw failure;
}

/** Fixed public-binary seam for a genuinely resolved private frame. Bytes stay opaque and owned:
 * Node reads/cancels the real request and writes/cancels the real response. No SDK/public JSON route.
 */
export async function nativePrivateFile(options: {
  readonly office: OfficeService;
  readonly actor: Actor;
  readonly file: NativePrivateFile;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly signal: AbortSignal;
  /** REQUIRED: any rejected real reader close must poison the request cleanup report. */
  readonly onCleanupFailure: () => void;
}): Promise<void> {
  const { office, actor, file, request, response, signal, onCleanupFailure } = options;
  try {
    if (file.kind === "download")
      return await downloadFile(
        office,
        actor,
        file.artifactId,
        request,
        response,
        signal,
        onCleanupFailure,
      );
    // The forwarding Worker uses the private POST convention for both binary directions.
    if (request.url !== uploadPath || request.method !== "POST") throw forbidden();
    return await uploadFile(office, actor, file, request, response, onCleanupFailure);
  } catch (error) {
    await deny(response, status(error));
  }
}
