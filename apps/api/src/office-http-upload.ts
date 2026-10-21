import { Option, Schema } from "effect";
import {
  ArtifactRef,
  Id,
  OFFICE_LIMITS,
  UploadHeaders,
  decodeWireSync,
} from "@starter/office-contract";

/** Real opaque upload metadata for the PRIVATE binding. Omission stays null, never a content SHA. */
export type OfficeUpload = {
  readonly operationId: string;
  readonly kind: "upload" | "code";
  readonly filename: string;
  readonly bytes: number;
  readonly digest: string | null;
};
export type OfficeUploadResult =
  | { readonly ok: true; readonly upload: OfficeUpload }
  | { readonly ok: false; readonly limited: boolean };
export function officeUploadMetadata(request: Request, operationId: string): OfficeUploadResult {
  if (Option.getOrNull(Schema.decodeUnknownOption(Id)(operationId)) === null)
    return { ok: false, limited: false };
  const digest = request.headers.get("x-office-digest");
  let header: typeof UploadHeaders.Type;
  try {
    header = decodeWireSync(UploadHeaders)({
      "x-office-kind": request.headers.get("x-office-kind") ?? "",
      "x-office-filename": request.headers.get("x-office-filename") ?? "",
      "x-office-bytes": Number(request.headers.get("x-office-bytes") ?? ""),
      ...(digest === null ? {} : { "x-office-digest": digest }),
    });
  } catch {
    return { ok: false, limited: false };
  }
  const cap =
    header["x-office-kind"] === "code" ? OFFICE_LIMITS.codeBytes : OFFICE_LIMITS.uploadBytes;
  if (header["x-office-bytes"] > cap) return { ok: false, limited: true };
  let filename: string;
  try {
    // The real client percent-encodes the header value; the private metadata is the real name.
    filename = decodeURIComponent(header["x-office-filename"]);
  } catch {
    return { ok: false, limited: false };
  }
  return {
    ok: true,
    upload: {
      operationId,
      kind: header["x-office-kind"],
      filename,
      bytes: header["x-office-bytes"],
      digest: header["x-office-digest"] ?? null,
    },
  };
}
export const officeArtifact = (value: unknown) =>
  Option.getOrNull(Schema.decodeUnknownOption(ArtifactRef, { onExcessProperty: "error" })(value));
/** The ACK must describe the bytes this request declared; nothing is relabelled after hashing. */
export const officeUploadReply = (upload: OfficeUpload, value: unknown) => {
  const ref = officeArtifact(value);
  if (ref === null || ref.kind !== upload.kind || ref.bytes !== upload.bytes) return null;
  if (upload.digest !== null && ref.digest !== upload.digest) return null;
  return ref;
};
