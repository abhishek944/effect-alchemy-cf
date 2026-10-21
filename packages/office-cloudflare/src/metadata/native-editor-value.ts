import { Schema } from "effect";
import type { NativeEditorPermit } from "@starter/office-server/ports";
import { validateNativeValueRef } from "@starter/office-server/native-remote";
import { readValueHeader } from "../native/value-headers.ts";
import { valueFingerprint } from "../native/value-proofs.ts";
import type { MetadataStore } from "./store.ts";
import { conflict } from "./store.ts";
import type { EditorLeaf } from "./native-editor-schema.ts";

/** Finite owning ref/header only; real T47 SDK producer attestation precedes native registration. */
export async function editorValue(
  db: MetadataStore,
  p: NativeEditorPermit,
  leaf: typeof EditorLeaf.Type,
) {
  const change = leaf.committed,
    key = leaf.receipt;
  if (
    leaf.submissionId !== p.submissionId ||
    leaf.payload.bytes > db.limits.nativeBytes ||
    change.unitID !== p.target.unitId ||
    change.baseRev !== p.expectedHead ||
    change.revision !== p.expectedHead + 1 ||
    change.sid !== p.sid ||
    change.reqId !== p.reqId ||
    key.revision !== change.revision ||
    change.value.kind !== "changeset"
  )
    throw conflict();
  validateNativeValueRef(change.value);
  const kind = { 1: "doc", 2: "sheet", 3: "slide" }[change.type];
  if (
    !(await db.first(
      `SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND unit=?
    AND json_extract(record,'$.document.kind')=?`,
      [db.owner(p.target.owner), p.target.documentId, p.target.unitId, kind],
    ))
  )
    throw conflict();
  if (p.target.scope.kind === "main") {
    if (key.kind !== "main-change") throw conflict();
  } else {
    const draft = await db.first<{ worktree: string }>(
      "SELECT worktree FROM office_meta_drafts WHERE owner=? AND id=? AND document=?",
      [db.owner(p.target.owner), p.target.scope.draftId, p.target.documentId],
    );
    if (!draft || key.kind !== "draft-change" || draft.worktree !== key.worktreeId)
      throw conflict();
  }
  const scope = db.native(p.target.owner, p.target.documentId, p.target.unitId);
  const hash = await valueFingerprint(change.value);
  const row = await db.first<{ header: string; kind: string }>(
    "SELECT header,kind FROM office_native_values WHERE scope=? AND value_hash=?",
    [scope, hash],
  );
  if (!row) return null;
  if (new TextEncoder().encode(row.header).byteLength > 4096) throw conflict("CONTENT_REQUIRED");
  const header = readValueHeader(db.decode(Schema.Unknown, row.header));
  if (header.kind !== "changeset" || row.kind !== "changeset") throw conflict();
  const nativeType: number = header.type;
  if (
    header.unitID !== change.unitID ||
    nativeType !== change.type ||
    header.baseRev !== change.baseRev ||
    header.revision !== change.revision ||
    header.sid !== change.sid ||
    header.reqId !== change.reqId
  )
    throw conflict();
  return { hash, header: row.header, scope };
}
