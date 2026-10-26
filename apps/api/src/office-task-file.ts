import { Schema } from "effect";
import { Count, officeImportOptions } from "@starter/office-contract";
import { AcceptedInputDigest, type AcceptedOriginalBinding } from "./chat-accepted-input-schema.ts";
import { FileMediaType, FileName } from "./chat-attachment-schema.ts";
import { DomainUuid } from "./chat-capabilities.ts";

/**
 * Retained earlier-Send file identity: same owner/chat catalog row, accepted history preserved.
 * Deliberately narrower than a Send original because it never participates in a new upload.
 * A CSV original keeps its `text` catalog kind; support is decided by the shared import policy,
 * so arbitrary text and images still fail this schema.
 */
export const OfficeTaskFile = Schema.Struct({
  fileId: DomainUuid,
  digest: AcceptedInputDigest,
  originOperationId: Schema.NullOr(DomainUuid),
  kind: Schema.Literals(["office", "text"]),
  name: FileName,
  byteSize: Count.check(Schema.isGreaterThan(0)),
  mediaType: FileMediaType,
  width: Schema.Null,
  height: Schema.Null,
}).check(Schema.makeFilter((file) => officeImportOptions(file.mediaType, file.name) !== null));
export type OfficeTaskFile = typeof OfficeTaskFile.Type;
export type OfficeTaskFileView = AcceptedOriginalBinding | OfficeTaskFile;
export type OfficeTaskFileSource = {
  readonly originals: readonly AcceptedOriginalBinding[];
  readonly retained: OfficeTaskFile | null;
};

/** Current Send original first; the retained binding only for a file this Send did not carry. */
export const officeTaskFile = (
  source: OfficeTaskFileSource,
  fileId: string | undefined,
): OfficeTaskFileView | undefined => {
  if (fileId === undefined) return undefined;
  const current = source.originals.find((file) => file.fileId === fileId);
  if (current !== undefined) return current;
  return source.retained?.fileId === fileId ? source.retained : undefined;
};

/** Every proven office file this task may select; still only content correlation, not authority. */
export const officeTaskFiles = (source: OfficeTaskFileSource): readonly OfficeTaskFileView[] =>
  Object.freeze([...source.originals, ...(source.retained === null ? [] : [source.retained])]);
