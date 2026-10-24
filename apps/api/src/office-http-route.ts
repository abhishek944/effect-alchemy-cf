import { Schema } from "effect";
import { Id, OfficeGroup, decodeWireSync } from "@starter/office-contract";
import type { HostOffice } from "@starter/office-server/native-remote";

export type OfficeRead = { readonly key: keyof typeof HostOffice; readonly input: unknown };
export type OfficeWrite = {
  readonly key: keyof typeof HostOffice;
  readonly payload: Schema.ConstraintDecoder<unknown> | null;
  readonly input: (payload: unknown) => unknown;
};
const endpoints = OfficeGroup.endpoints;
const id = "([A-Za-z0-9_-]{16,96})";
const pattern = (path: string) => new RegExp(`^${path.replace(/:[A-Za-z]+/g, id)}$`);
const P = {
  documents: endpoints.list.path,
  drafts: endpoints.drafts.path,
  document: pattern(endpoints.document.path),
  draft: pattern(endpoints.draft.path),
  review: pattern(endpoints.review.path),
  receipt: pattern(endpoints.receipt.path),
  cancel: pattern(endpoints.cancel.path),
  events: pattern(endpoints.events.path),
  upload: pattern(endpoints.upload.path),
  artifact: pattern(endpoints.artifact.path),
  bytes: pattern(endpoints.download.path),
};
// Finite private command selection; public paths and payload validation belong to OfficeGroup.
const writes = [
  endpoints.create,
  endpoints.createDraft,
  endpoints.open,
  endpoints.editor,
  endpoints.execute,
  endpoints.inspect,
  endpoints.render,
  endpoints.export,
  endpoints.ready,
  endpoints.approve,
  endpoints.merge,
  endpoints.reopen,
  endpoints.discard,
  endpoints.importInto,
].map((endpoint) => {
  const json = endpoint.payload.get("application/json");
  if (json === undefined) throw new Error("Office command requires a JSON payload contract");
  return {
    key: endpoint.identifier,
    path: endpoint.path,
    method: endpoint.method,
    // The body has already been parsed as JSON. Validate the contract's domain value strictly.
    payload: Schema.Union(json.schemas.map((schema) => Schema.toType(schema))),
    input: (payload: unknown) => payload,
  };
});
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

/** Events use `after`; never silently ignore an unsupported cursor. */
export const officeUnsupportedCursor = (
  method: string,
  pathname: string,
  query: URLSearchParams,
): boolean => method === "GET" && P.events.test(pathname) && query.has("cursor");
export const officeUploadPath = (pathname: string) => capture(P.upload.exec(pathname));
export const officeArtifactPath = (pathname: string) => capture(P.artifact.exec(pathname));
export const officeBytesPath = (pathname: string) => capture(P.bytes.exec(pathname));

/** Translate public path/query names into the finite private command's input. */
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

export function officeWrite(method: string, pathname: string): OfficeWrite | null {
  const route = writes.find((endpoint) => endpoint.method === method && endpoint.path === pathname);
  if (route !== undefined) return route;
  const cancel = method === endpoints.cancel.method ? capture(P.cancel.exec(pathname)) : null;
  return cancel === null
    ? null
    : { key: "cancel", payload: null, input: () => ({ operationId: cancel }) };
}
