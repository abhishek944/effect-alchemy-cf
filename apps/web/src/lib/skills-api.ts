/**
 * Same-origin client for the owner-scoped Skills routes.
 *
 * Every response is validated before use. POST /api/skills sends exactly one
 * raw File with its stable upload id; GET /api/skills?uploadId= only inspects
 * the receipt, so an uncertain delivery is never replayed automatically.
 */
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

  constructor(
    status: number,
    message: string,
    code: SkillErrorBody["code"] | null,
    current: SkillFile | null,
  ) {
    super(message);
    this.name = "SkillsApiError";
    this.status = status;
    this.code = code;
    this.current = current;
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

const unexpectedResponse = (): SkillsApiError =>
  new SkillsApiError(502, "The server returned an unexpected response.", null, null);

async function failure(response: Response): Promise<SkillsApiError> {
  let parsed: SkillErrorBody | null = null;
  try {
    parsed = parseSkillError(await response.json());
  } catch {
    parsed = null;
  }
  const message =
    parsed?.message ?? statusMessages[response.status] ?? `Request failed (${response.status}).`;
  return new SkillsApiError(
    response.status,
    message,
    parsed?.code ?? null,
    parsed?.current ?? null,
  );
}

async function skillsRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...init,
  });
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined;
  return response.json();
}

export async function listSkills(uploadId?: string, signal?: AbortSignal): Promise<SkillList> {
  const query = uploadId === undefined ? "" : `?uploadId=${encodeURIComponent(uploadId)}`;
  const list = parseSkillList(
    await skillsRequest(`/api/skills${query}`, signal === undefined ? undefined : { signal }),
  );
  if (list === null) throw unexpectedResponse();
  return list;
}

export async function uploadSkill(input: {
  file: File;
  filename: string;
  uploadId: string;
  replaceVersion: string | null;
}): Promise<PublishedSkillUpload> {
  const query = new URLSearchParams({ filename: input.filename, uploadId: input.uploadId });
  if (input.replaceVersion !== null) query.set("replaceVersion", input.replaceVersion);
  const receipt = parsePublishedSkillUpload(
    await skillsRequest(`/api/skills?${query.toString()}`, {
      method: "POST",
      headers: { "content-type": input.file.type || "text/plain" },
      body: input.file,
    }),
  );
  if (receipt === null) throw unexpectedResponse();
  return receipt;
}

/**
 * Explicit cancellation of one frozen retained intent. Success is only a
 * published receipt (the upload already completed) or an expired receipt (the
 * exact intent is authoritatively fenced); GET is never involved.
 */
export async function cancelSkillUpload(uploadId: string): Promise<SkillUploadReceipt> {
  const receipt = parseSkillReceipt(
    await skillsRequest(`/api/skills/cancel?uploadId=${encodeURIComponent(uploadId)}`, {
      method: "POST",
    }),
  );
  if (receipt === null) throw unexpectedResponse();
  return receipt;
}

/** A non-attachment, redirected or oversized 200 is never the original file. */
const invalidDownload = (): SkillsApiError =>
  new SkillsApiError(
    502,
    "The download did not return the original skill file. Try again.",
    null,
    null,
  );

/**
 * Original bytes of one immutable version. A 200 is accepted only as a
 * non-redirected attachment with a text/plain type and a bounded nonempty
 * body; the bytes are saved, never rendered on the app origin.
 */
export async function downloadSkill(file: SkillFile, signal?: AbortSignal): Promise<Blob> {
  const query = new URLSearchParams({ id: file.id, version: file.version });
  const response = await fetch(`/api/skills/download?${query.toString()}`, {
    credentials: "same-origin",
    redirect: "error",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await failure(response);
  const disposition = (response.headers.get("content-disposition") ?? "").toLowerCase();
  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (response.redirected || !disposition.includes("attachment") || mediaType !== "text/plain") {
    throw invalidDownload();
  }
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_SKILL_BYTES) throw invalidDownload();
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_SKILL_BYTES) throw invalidDownload();
  return new Blob([buffer], { type: "text/plain" });
}
