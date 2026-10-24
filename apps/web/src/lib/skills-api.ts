/** Validated owner Skills client; receipt GET only observes, and uncertain POST is never replayed. */
import { readResponseRequestId, serverReference, withReference } from "./browser-diagnostics";
import {
  MAX_SKILL_BYTES,
  parsePublishedSkillUpload,
  parseSkillError,
  parseSkillList,
  parseSkillReceipt,
} from "./skills-validate";
import type {
  PublishedSkillUpload,
  SkillErrorBody,
  SkillFile,
  SkillList,
  SkillUploadReceipt,
} from "./skills-types";
export class SkillsApiError extends Error {
  readonly status: number;
  readonly code: SkillErrorBody["code"] | null;
  readonly current: SkillFile | null;
  readonly requestId: string | null;

  constructor(
    status: number,
    message: string,
    code: SkillErrorBody["code"] | null,
    current: SkillFile | null,
    requestId: string | null = null,
    operation = "skills.request",
    responseStatus = status,
  ) {
    super(withReference(message, serverReference(operation, responseStatus, requestId)));
    this.name = "SkillsApiError";
    this.status = status;
    this.code = code;
    this.current = current;
    this.requestId = requestId;
  }
}
const statusMessages: Record<number, string> = {
  400: "That upload was not valid. Try again.",
  401: "You are signed out. Sign in again to manage skills.",
  403: "This request was blocked. Reload the page and try again.",
  404: "That skill is no longer available.",
  409: "A skill with that filename already exists.",
  413: "That file is too large. Skills are limited to 64 KiB.",
  422: "That skill file was not valid.",
  429: "Too many requests. Wait a moment and try again.",
  503: "Skills are temporarily unavailable. Try again shortly.",
  507: "The skill library has reached a retention limit.",
};
export function skillsErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The request was cancelled.";
  }
  if (error instanceof SkillsApiError) return error.message;
  if (error instanceof TypeError) {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}
const unexpectedResponse = (response: Response, operation: string): SkillsApiError =>
  new SkillsApiError(
    502,
    "The server returned an unexpected response.",
    null,
    null,
    readResponseRequestId(response),
    operation,
    response.status,
  );
async function failure(response: Response, operation: string): Promise<SkillsApiError> {
  let parsed: SkillErrorBody | null = null;
  try {
    parsed = parseSkillError(await response.json());
  } catch {
    parsed = null;
  }
  const message = statusMessages[response.status] ?? `Request failed (${response.status}).`;
  return new SkillsApiError(
    response.status,
    message,
    parsed?.code ?? null,
    parsed?.current ?? null,
    readResponseRequestId(response),
    operation,
  );
}
async function skillsRequest<T>(
  path: string,
  operation: string,
  parse: (body: unknown) => T | null,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...init,
  });
  if (!response.ok) throw await failure(response, operation);
  let body: unknown;
  try {
    body = response.status === 204 ? undefined : await response.json();
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw unexpectedResponse(response, operation);
  }
  const value = parse(body);
  if (value === null) throw unexpectedResponse(response, operation);
  return value;
}

export async function listSkills(uploadId?: string, signal?: AbortSignal): Promise<SkillList> {
  const query = uploadId === undefined ? "" : `?uploadId=${encodeURIComponent(uploadId)}`;
  return skillsRequest(
    `/api/skills${query}`,
    "skills.list",
    parseSkillList,
    signal === undefined ? undefined : { signal },
  );
}

export async function uploadSkill(input: {
  file: File;
  filename: string;
  uploadId: string;
  replaceVersion: string | null;
}): Promise<PublishedSkillUpload> {
  const query = new URLSearchParams({ filename: input.filename, uploadId: input.uploadId });
  if (input.replaceVersion !== null) query.set("replaceVersion", input.replaceVersion);
  return skillsRequest(
    `/api/skills?${query.toString()}`,
    "skills.upload",
    parsePublishedSkillUpload,
    {
      method: "POST",
      headers: { "content-type": input.file.type || "text/plain" },
      body: input.file,
    },
  );
}

/** Cancels one frozen intent: only published/expired receipts confirm success; never GET. */
export async function cancelSkillUpload(uploadId: string): Promise<SkillUploadReceipt> {
  return skillsRequest(
    `/api/skills/cancel?uploadId=${encodeURIComponent(uploadId)}`,
    "skills.cancel",
    parseSkillReceipt,
    { method: "POST" },
  );
}

/** A non-attachment, redirected or oversized 200 is never the original file. */
const invalidDownload = (response: Response): SkillsApiError =>
  new SkillsApiError(
    502,
    "The download did not return the original skill file. Try again.",
    null,
    null,
    readResponseRequestId(response),
    "skills.download",
    response.status,
  );

/** Immutable original: bounded nonempty text/plain attachment, never redirected or rendered. */
export async function downloadSkill(file: SkillFile, signal?: AbortSignal): Promise<Blob> {
  const query = new URLSearchParams({ id: file.id, version: file.version });
  const response = await fetch(`/api/skills/download?${query.toString()}`, {
    credentials: "same-origin",
    redirect: "error",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await failure(response, "skills.download");
  const disposition = (response.headers.get("content-disposition") ?? "").toLowerCase();
  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (response.redirected || !disposition.includes("attachment") || mediaType !== "text/plain") {
    throw invalidDownload(response);
  }
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_SKILL_BYTES) throw invalidDownload(response);
  const buffer = await response.arrayBuffer().catch((cause: unknown) => {
    if (
      cause instanceof SkillsApiError ||
      signal?.aborted ||
      (cause instanceof Error && /^(AbortError|TimeoutError)$/.test(cause.name))
    )
      throw cause;
    throw Object.assign(invalidDownload(response), { cause });
  });
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_SKILL_BYTES)
    throw invalidDownload(response);
  return new Blob([buffer], { type: "text/plain" });
}
