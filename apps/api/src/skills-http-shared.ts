/**
 * Shared wire helpers for the native skills HTTP routes.
 *
 * Internal catalog failures are translated once here: a decodable SkillError
 * keeps its code, message and nullable current conflict file; anything else
 * becomes a safe `skills_unavailable` response. No internal key or detail leaks.
 */
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { DoCall } from "./chat-bindings.ts";
import { decodeOption } from "./chat-internal.ts";
import { SkillError } from "./skills-model.ts";

export const jsonResponse = (
  body: unknown,
  status: number,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.fromWeb(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }),
  );

export const STATUS: Record<SkillError["code"], number> = {
  invalid_skill: 422,
  skill_exists: 409,
  skill_conflict: 409,
  skill_limit: 507,
  skills_unavailable: 503,
  skill_upload_unknown: 404,
};

export const unavailable = (message: string, status = 503): HttpServerResponse.HttpServerResponse =>
  jsonResponse({ code: "skills_unavailable", message, current: null }, status);

export const invalidSkill = (
  message: string,
  status = 422,
): HttpServerResponse.HttpServerResponse =>
  jsonResponse({ code: "invalid_skill", message, current: null }, status);

/** Uses the catalog's own SkillError body when present, else a safe fallback. */
export const internalFailure = (
  call: DoCall,
  fallback: string,
): HttpServerResponse.HttpServerResponse => {
  const error = decodeOption(SkillError, call.body);
  if (error === null) return unavailable(fallback);
  // A deliberate private missing-file denial is validated 404, not service down.
  const status =
    error.code === "skills_unavailable" && call.status === 404 ? 404 : STATUS[error.code];
  return jsonResponse({ code: error.code, message: error.message, current: error.current }, status);
};
