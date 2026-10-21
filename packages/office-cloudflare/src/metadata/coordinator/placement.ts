import type { MetadataStore } from "../store.ts";
import { conflict } from "../store.ts";
import { requireContext, forbidden } from "./context.ts";
import { documentHead, placementRow } from "./rows.ts";
import { DocumentKeySchema, PlacementChangeSchema } from "./schemas.ts";
import { claimPlacement } from "./placement-claim.ts";
import { changePlacement } from "./placement-change.ts";
import type {
  DocumentKey,
  Placement,
  PlacementChange,
  VerifiedCoordinatorContext,
} from "./types.ts";

export async function readPlacement(
  db: MetadataStore,
  context: VerifiedCoordinatorContext,
  inputDocument: DocumentKey,
): Promise<Placement | null> {
  const document = db.decode(DocumentKeySchema, db.encode(DocumentKeySchema, inputDocument));
  const key = await requireContext(db, context, document);
  const head = await documentHead(db, key.owner, document.documentId);
  if (!head) return null;
  const saved = await placementRow(db, head.placement_id);
  if (
    !saved ||
    saved.row.scope !== key.scope ||
    head.unit !== document.unitId ||
    saved.value.authorityEpoch !== head.authority_epoch ||
    saved.value.serviceEpoch !== head.service_epoch ||
    saved.value.until !== head.placement_until ||
    saved.value.state !== head.state
  )
    throw conflict();
  return saved.value;
}
export async function place(
  db: MetadataStore,
  context: VerifiedCoordinatorContext,
  inputDocument: DocumentKey,
  input: PlacementChange,
): Promise<Placement> {
  if (context.kind !== "placement") throw forbidden();
  const document = db.decode(DocumentKeySchema, db.encode(DocumentKeySchema, inputDocument));
  const change = db.decode(PlacementChangeSchema, db.encode(PlacementChangeSchema, input));
  const key = await requireContext(db, context, document);
  return change.kind === "claim"
    ? claimPlacement(db, context, document, key, change)
    : changePlacement(db, context, document, key, change);
}
