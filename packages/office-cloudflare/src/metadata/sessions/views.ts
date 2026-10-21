import { Id, decodeWireSync } from "@starter/office-contract";
import type { OwnerScope, ViewRecord } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "../store.ts";
import type { PredicateSQL } from "../native-fence.ts";
import { canonical, conflict, sqlNow } from "../store.ts";
import { artifactEdges } from "../artifacts.ts";
import { ViewRow } from "./schemas.ts";
import { validateView, viewIdentity, viewSQL } from "./fence.ts";

type Stored = { record: string; binding: string };
export async function storedView(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
): Promise<Stored | null> {
  decodeWireSync(Id)(id);
  return db.first("SELECT record,binding FROM office_meta_views WHERE owner=? AND id=?", [
    db.owner(owner),
    id,
  ]);
}
export async function readView(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
): Promise<ViewRecord | null> {
  const row = await storedView(db, owner, id);
  if (!row) return null;
  const record = db.decode(ViewRow, row.record);
  validateView(record);
  if (canonical(record.owner) !== canonical(owner) || record.view.id !== id) throw conflict();
  return record;
}
export async function activeView(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
): Promise<ViewRecord | null> {
  const record = await readView(db, owner, id);
  if (record) {
    const fence = viewSQL(db, record, false);
    if (!(await db.first(`SELECT 1 WHERE ${fence.sql}`, fence.values)))
      throw conflict("AUTHORITY_LOST");
  }
  return record;
}
export async function prepareView(
  db: MetadataStore,
  input: ViewRecord,
  exact?: boolean,
): Promise<{
  record: ViewRecord;
  fence: PredicateSQL;
  statements: Statement[];
}> {
  const record = db.decode(ViewRow, db.encode(ViewRow, input));
  validateView(record);
  const owner = db.owner(record.owner),
    id = record.view.id;
  const previous = await storedView(db, record.owner, id);
  const identity = viewIdentity(record),
    binding = await db.hash(identity);
  let guard: PredicateSQL;
  if (previous) {
    const old = db.decode(ViewRow, previous.record);
    if (
      previous.binding !== binding ||
      canonical(viewIdentity(old)) !== canonical(identity) ||
      record.view.expiresAt < old.view.expiresAt
    )
      throw conflict();
    guard = {
      sql: `EXISTS(SELECT 1 FROM office_meta_views WHERE owner=? AND id=? AND record=? AND expires>${sqlNow})`,
      values: [owner, id, previous.record],
    };
  } else
    guard = {
      sql: "NOT EXISTS(SELECT 1 FROM office_meta_views WHERE owner=? AND id=?)",
      values: [owner, id],
    };
  const native = viewSQL(db, record, exact ?? previous === null);
  const statement: Statement = previous
    ? [
        "UPDATE office_meta_views SET expires=?,record=? WHERE owner=? AND id=?",
        [record.view.expiresAt, db.encode(ViewRow, record), owner, id],
      ]
    : [
        "INSERT INTO office_meta_views VALUES(?,?,?,?,?,?)",
        [
          owner,
          id,
          record.view.documentId,
          record.view.expiresAt,
          db.encode(ViewRow, record),
          binding,
        ],
      ];
  const refs = record.source.kind === "artifact" ? [record.source.artifact] : [];
  return {
    record,
    fence: {
      sql: `(${guard.sql}) AND (${native.sql})`,
      values: [...guard.values, ...native.values],
    },
    statements: [statement, ...artifactEdges(db, record.owner, "view", id, refs)],
  };
}
