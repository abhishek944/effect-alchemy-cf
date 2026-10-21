import { Schema } from "effect";
import { FileDescriptor } from "./chat-attachment-schema.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { ImageCallId, ImageSources } from "./chat-image-storage-schema.ts";

export const SavedFile = Schema.Struct({
  ...FileDescriptor.fields,
  origin: Schema.Literals(["upload", "generated"]),
  sources: ImageSources,
  generation: Schema.NullOr(Schema.Struct({ callId: ImageCallId, operationId: DomainUuid })),
}).check(Schema.makeFilter((file) => Schema.is(FileDescriptor)(file)));
export type SavedFile = typeof SavedFile.Type;
export const LibraryQuery = Schema.Struct({
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(120))),
  kind: Schema.optional(Schema.Literals(["all", "image", "text"])),
  origin: Schema.optional(Schema.Literals(["all", "upload", "generated"])),
  sort: Schema.optional(Schema.Literals(["newest", "oldest", "name"])),
  cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(50)),
  ),
});
export type LibraryQuery = typeof LibraryQuery.Type;
export const SavedLibraryPage = Schema.Struct({
  chatId: DomainUuid,
  files: Schema.Array(SavedFile).check(Schema.isMaxLength(50)),
  nextCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
});
export type SavedLibraryPage = typeof SavedLibraryPage.Type;
