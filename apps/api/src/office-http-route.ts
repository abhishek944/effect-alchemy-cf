import type { Schema } from "effect";
import {
  Approve,
  CreateDocument,
  CreateDraft,
  DraftTransition,
  EditorAction,
  Execute,
  ExportRequest,
  Id,
  ImportInto,
  InspectRequest,
  Merge,
  RenderRequest,
  Target,
  decodeWireSync,
} from "@starter/office-contract";
import type { HostOffice } from "@starter/office-server/native-remote";

/** Public GET commands: the private input is built from the real path/query contract. */
export type OfficeRead = { readonly key: keyof typeof HostOffice; readonly input: unknown };
/** Public POST command plus the real payload schema; null payload means path-params only. */
export type OfficeWrite = {
  readonly key: keyof typeof HostOffice;
  readonly payload: Schema.ConstraintDecoder<unknown> | null;
  readonly input: (payload: unknown) => unknown;
};
const id = "([A-Za-z0-9_-]{16,96})";
const pattern = (path: string) => new RegExp(`^${path}$`);
const P = {
  documents: "/api/office/documents",
  drafts: "/api/office/drafts",
  document: pattern(`/api/office/documents/${id}`),
  draft: pattern(`/api/office/drafts/${id}`),
  review: pattern(`/api/office/reviews/${id}`),
  receipt: pattern(`/api/office/operations/${id}`),
  cancel: pattern(`/api/office/operations/${id}/cancel`),
  events: pattern(`/api/office/documents/${id}/events`),
  upload: pattern(`/api/office/uploads/${id}`),
  artifact: pattern(`/api/office/artifacts/${id}`),
  bytes: pattern(`/api/office/artifacts/${id}/bytes`),
};
const cursor = (query: URLSearchParams): string | null => query.get("cursor");
const single = (query: URLSearchParams, name: string): string | null => {
  const all = query.getAll(name);
  return all.length === 1 ? (all[0] ?? null) : null;
};
const capture = (match: RegExpExecArray | null): string | null => {
  if (match === null) return null;
  try {
    return decodeWireSync(Id)(match[1] ?? "");
  } catch {
    return null;
  }
};

/** `after` is the actual supported events pagination; a supplied cursor cannot be carried. */
export const officeUnsupportedCursor = (
  method: string,
  pathname: string,
  query: URLSearchParams,
): boolean => method === "GET" && P.events.test(pathname) && query.has("cursor");
export const officeUploadPath = (pathname: string) => capture(P.upload.exec(pathname));
export const officeArtifactPath = (pathname: string) => capture(P.artifact.exec(pathname));
export const officeBytesPath = (pathname: string) => capture(P.bytes.exec(pathname));

/** Register-free pure match for an authenticated public read. */
export function officeRead(
  method: string,
  pathname: string,
  query: URLSearchParams,
): OfficeRead | null {
  if (method !== "GET") return null;
  if (pathname === P.documents) return { key: "list", input: { cursor: cursor(query) } };
  if (pathname === P.drafts) return { key: "drafts", input: { cursor: cursor(query) } };
  const document = capture(P.document.exec(pathname));
  if (document !== null) return { key: "document", input: { id: document } };
  const draft = capture(P.draft.exec(pathname));
  if (draft !== null) return { key: "draft", input: { id: draft } };
  const review = capture(P.review.exec(pathname));
  if (review !== null) return { key: "review", input: { reviewId: review, cursor: cursor(query) } };
  const receipt = capture(P.receipt.exec(pathname));
  if (receipt !== null) return { key: "receipt", input: { operationId: receipt } };
  const events = capture(P.events.exec(pathname));
  if (events !== null)
    return {
      key: "events",
      input: { documentId: events, after: Number(single(query, "after") ?? "") },
    };
  return null;
}

/** Register-free pure match for an authenticated public command payload. */
export function officeWrite(method: string, pathname: string): OfficeWrite | null {
  if (method !== "POST") return null;
  switch (pathname) {
    case "/api/office/documents":
      return { key: "create", payload: CreateDocument, input: (payload) => payload };
    case "/api/office/drafts":
      return { key: "createDraft", payload: CreateDraft, input: (payload) => payload };
    case "/api/office/views":
      return { key: "open", payload: Target, input: (payload) => payload };
    case "/api/office/editors":
      return { key: "editor", payload: EditorAction, input: (payload) => payload };
    case "/api/office/execute":
      return { key: "execute", payload: Execute, input: (payload) => payload };
    case "/api/office/inspect":
      return { key: "inspect", payload: InspectRequest, input: (payload) => payload };
    case "/api/office/render":
      return { key: "render", payload: RenderRequest, input: (payload) => payload };
    case "/api/office/export":
      return { key: "export", payload: ExportRequest, input: (payload) => payload };
    case "/api/office/ready":
      return { key: "ready", payload: DraftTransition, input: (payload) => payload };
    case "/api/office/approve":
      return { key: "approve", payload: Approve, input: (payload) => payload };
    case "/api/office/merge":
      return { key: "merge", payload: Merge, input: (payload) => payload };
    case "/api/office/reopen":
      return { key: "reopen", payload: DraftTransition, input: (payload) => payload };
    case "/api/office/discard":
      return { key: "discard", payload: DraftTransition, input: (payload) => payload };
    case "/api/office/import-into":
      return { key: "importInto", payload: ImportInto, input: (payload) => payload };
  }
  const cancel = capture(P.cancel.exec(pathname));
  if (cancel !== null) {
    return { key: "cancel", payload: null, input: () => ({ operationId: cancel }) };
  }
  return null;
}
