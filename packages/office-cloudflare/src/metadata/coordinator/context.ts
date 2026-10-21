import { OfficeForbidden, decodeWireSync, safeFailure } from "@starter/office-contract";
import type { MetadataStore } from "../store.ts";
import { canonical, sqlNow } from "../store.ts";
import type { DocumentKey, VerifiedCoordinatorContext } from "./types.ts";
import { DocumentKeySchema, VerifiedContext } from "./schemas.ts";
import { requireCoordinatorSchema } from "./schema.ts";

export const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
export function captureContext(
  db: MetadataStore,
  value: VerifiedCoordinatorContext,
): VerifiedCoordinatorContext {
  try {
    // A detached strict copy prevents mutation of the caller's claimed context after construction.
    const context = db.decode(VerifiedContext, db.encode(VerifiedContext, value));
    db.owner(context.document.owner);
    if (context.kind !== "placement") {
      const target = context.target;
      if (
        canonical(context.document) !==
        canonical({ owner: target.owner, documentId: target.documentId, unitId: target.unitId })
      )
        throw forbidden();
    }
    return context;
  } catch {
    throw forbidden();
  }
}
export async function requireContext(
  db: MetadataStore,
  context: VerifiedCoordinatorContext,
  input: DocumentKey,
): Promise<{ owner: string; scope: string }> {
  const document = decodeWireSync(DocumentKeySchema)(input);
  if (canonical(document) !== canonical(context.document)) throw forbidden();
  for (const id of [
    document.owner.stage,
    document.owner.ownerId,
    document.documentId,
    document.unitId,
  ])
    if (new TextEncoder().encode(id).byteLength > 256) throw forbidden();
  const owner = db.owner(document.owner);
  await requireCoordinatorSchema(db.options.database);
  const present = await db.first(
    `SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND unit=? AND ?>${sqlNow}`,
    [owner, document.documentId, document.unitId, context.notAfter],
  );
  if (!present) throw forbidden();
  return { owner, scope: db.native(document.owner, document.documentId, document.unitId) };
}
