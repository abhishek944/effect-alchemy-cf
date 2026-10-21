/**
 * DO-internal `/skills/*` routes for the private owner library.
 *
 * Reachable only through the owner catalog stub from server code. Owner scope is
 * the object instance; no request field can select another owner's library.
 * Success bodies use the public schemas from skills-model.ts, and failures are
 * SkillError envelopes with honest codes and the nullable current conflict file.
 */
import type * as cf from "@cloudflare/workers-types";
import { decodeOption, json, requestBody } from "./chat-internal.ts";
import {
  SkillCancelRequest,
  SkillId,
  SkillPublishRequest,
  SkillReservationRequest,
  SkillRevision,
  type SkillError,
} from "./skills-model.ts";
import type { SkillsResult } from "./skills-result.ts";
import type { SkillsCatalog } from "./skills-store.ts";

const respond = <T>(result: SkillsResult<T>): Response =>
  result.ok
    ? json(result.value)
    : json({ code: result.code, message: result.message, current: result.current }, result.status);

const invalid = (message: string, status = 400): Response =>
  json({ code: "invalid_skill", message, current: null } satisfies SkillError, status);

export const handleSkillsCatalog = async (
  catalog: SkillsCatalog,
  request: Request,
  bucket: cf.R2Bucket | undefined,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const now = Date.now();
  switch (route) {
    case "GET /skills": {
      const uploadId = url.searchParams.get("uploadId");
      if (uploadId !== null && decodeOption(SkillId, uploadId) === null)
        return invalid("That upload id is not valid.");
      return respond(await catalog.list(uploadId));
    }
    case "GET /skills/snapshot": {
      const revision = url.searchParams.get("revision");
      if (revision !== null && decodeOption(SkillRevision, revision) === null)
        return invalid("That revision is not valid.");
      return respond(await catalog.snapshot(revision));
    }
    case "POST /skills/reserve": {
      const body = decodeOption(SkillReservationRequest, await requestBody(request));
      if (body === null) return invalid("That skill reservation is not valid.");
      return respond(catalog.reserve(body, now));
    }
    case "POST /skills/publish": {
      const body = decodeOption(SkillPublishRequest, await requestBody(request));
      if (body === null) return invalid("That publish request is not valid.");
      return respond(await catalog.publish(body.uploadId, bucket, now));
    }
    case "POST /skills/cancel": {
      const body = decodeOption(SkillCancelRequest, await requestBody(request));
      if (body === null) return invalid("That cancellation request is not valid.");
      return respond(catalog.cancel(body.uploadId, now));
    }
    case "GET /skills/file": {
      const id = decodeOption(SkillId, url.searchParams.get("id"));
      const version = decodeOption(SkillId, url.searchParams.get("version"));
      if (id === null || version === null)
        return invalid("That skill file reference is not valid.");
      return respond(catalog.file(id, version));
    }
    default:
      return null;
  }
};
