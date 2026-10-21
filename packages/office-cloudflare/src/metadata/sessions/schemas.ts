import { Schema } from "effect";
import {
  ArtifactRef,
  Count,
  DocumentScope,
  Editor,
  Id,
  Revision,
  View,
} from "@starter/office-contract";
import { OwnerClaims } from "@starter/office-server/ports";
import { NativeId } from "../schemas.ts";

const Epoch = Count.check(Schema.isGreaterThanOrEqualTo(1));
export const ViewRow = Schema.Struct({
  owner: OwnerClaims,
  view: View,
  target: Schema.Struct({
    owner: OwnerClaims,
    documentId: Id,
    unitId: NativeId,
    scope: DocumentScope,
  }),
  authorityEpoch: Epoch,
  serviceEpoch: Epoch,
  source: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("core"), revision: Revision }),
    Schema.Struct({ kind: Schema.Literal("draft"), worktreeId: NativeId, revision: Revision }),
    Schema.Struct({ kind: Schema.Literal("artifact"), artifact: ArtifactRef }),
  ]),
});
export const LeaseRow = Schema.Struct({
  editor: Editor,
  confirmedRevision: Schema.NullOr(Revision),
});
export const sessionSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS office_meta_views (owner TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,
    expires INTEGER NOT NULL,record TEXT NOT NULL,binding TEXT NOT NULL,PRIMARY KEY(owner,id))`,
] as const;
