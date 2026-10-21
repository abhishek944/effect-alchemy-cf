/**
 * Native raw single-file upload for the private skill library.
 *
 * The body is the only file content accepted (no multipart, no archive). Bytes
 * are bounded and validated before the durable reservation, stored under the
 * catalog-derived owner scope, verified after the PUT, and published as one
 * immutable version. An uncertain publish keeps the reservation inspectable via
 * GET receipts instead of replaying a possibly accepted write.
 */
import type * as cf from "@cloudflare/workers-types";
import { Effect } from "effect";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import { readBoundedBody } from "./body-limit.ts";
import { doCall } from "./chat-bindings.ts";
import { decodeOption } from "./chat-internal.ts";
import type { ChatUnavailable } from "./chat-model.ts";
import {
  MAX_SKILL_BYTES,
  SkillFilename,
  SkillId,
  SkillReservation,
  SkillUploadReceipt,
} from "./skills-model.ts";
import { invalidSkill, internalFailure, jsonResponse, unavailable } from "./skills-http-shared.ts";
import { putSkillObject } from "./skills-objects.ts";
import { validateSkillUpload } from "./skills-upload.ts";

export type SkillUploadInput = {
  readonly catalog: cf.DurableObjectStub;
  readonly owner: Record<string, string>;
  readonly scope: string;
  readonly bucket: cf.R2Bucket;
  readonly url: URL;
  readonly web: Request;
};

export const uploadSkill = (
  input: SkillUploadInput,
): Effect.Effect<HttpServerResponse.HttpServerResponse, ChatUnavailable> =>
  Effect.gen(function* () {
    const { catalog, owner, scope, bucket, url, web } = input;
    const filename = decodeOption(SkillFilename, url.searchParams.get("filename"));
    const uploadId = decodeOption(SkillId, url.searchParams.get("uploadId"));
    const replaceRaw = url.searchParams.get("replaceVersion");
    const replaceVersion = replaceRaw === null ? null : decodeOption(SkillId, replaceRaw);
    if (filename === null || uploadId === null || (replaceRaw !== null && replaceVersion === null))
      return invalidSkill("Provide one .txt or .md filename and a valid upload id.", 400);
    const contentType = (web.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.startsWith("multipart/"))
      return invalidSkill("Upload one raw .txt or .md file body.", 415);
    const bytes = yield* Effect.promise(() => readBoundedBody(web, MAX_SKILL_BYTES));
    if (bytes === null)
      return invalidSkill(
        "That file is larger than 64 KiB. Choose a smaller .txt or .md file.",
        413,
      );
    const validation = yield* Effect.promise(() => validateSkillUpload(bytes));
    if (!validation.ok) return invalidSkill(validation.message);
    const reservation = yield* doCall(
      catalog,
      "POST",
      "/skills/reserve",
      { uploadId, filename, digest: validation.digest, byteSize: bytes.byteLength, replaceVersion },
      owner,
    );
    if (reservation.status !== 200)
      return internalFailure(
        reservation,
        "The skill library is unavailable. Nothing was published.",
      );
    const reserved = decodeOption(SkillReservation, reservation.body);
    // The reservation must describe this exact owner scope, upload id and file
    // intent before any returned version ref or acknowledgement is trusted.
    if (
      reserved === null ||
      reserved.uploadId !== uploadId ||
      reserved.ownerScope !== scope ||
      reserved.file.filename !== filename ||
      reserved.file.digest !== validation.digest ||
      reserved.file.byteSize !== bytes.byteLength
    )
      return unavailable("The skill library returned an invalid reservation.");
    if (reserved.revision !== null) {
      const already = decodeOption(SkillUploadReceipt, {
        uploadId,
        state: "published",
        revision: reserved.revision,
        file: {
          id: reserved.file.id,
          filename: reserved.file.filename,
          version: reserved.file.version,
        },
      });
      if (
        already === null ||
        already.state !== "published" ||
        already.uploadId !== uploadId ||
        already.file.id !== reserved.file.id ||
        already.file.version !== reserved.file.version ||
        already.file.filename !== filename
      )
        return unavailable("The skill library returned an invalid acknowledgement.");
      return jsonResponse(already, 200);
    }
    const stored = yield* Effect.promise(async () => {
      try {
        await putSkillObject(bucket, scope, reserved.file, bytes);
        return true;
      } catch {
        return false;
      }
    });
    if (!stored)
      return unavailable("The file could not be saved privately. Your local file is unchanged.");
    const publish = yield* doCall(catalog, "POST", "/skills/publish", { uploadId }, owner);
    if (publish.status !== 200)
      return internalFailure(
        publish,
        "The upload is not yet acknowledged. Check the library before uploading again.",
      );
    const receipt = decodeOption(SkillUploadReceipt, publish.body);
    // The acknowledgement must be a publication of this exact reserved version.
    if (
      receipt === null ||
      receipt.state !== "published" ||
      receipt.uploadId !== uploadId ||
      receipt.file.id !== reserved.file.id ||
      receipt.file.version !== reserved.file.version ||
      receipt.file.filename !== filename
    )
      return unavailable(
        "The upload is not yet acknowledged. Check the library before uploading again.",
      );
    return jsonResponse(receipt, 200);
  });
