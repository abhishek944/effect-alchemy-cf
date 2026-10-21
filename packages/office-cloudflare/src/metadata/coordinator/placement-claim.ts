import { decodeWireSync } from "@starter/office-contract";
import type { MetadataStore, Statement } from "../store.ts";
import { canonical, conflict, sqlNow } from "../store.ts";
import { Positive, PlacementSchema } from "./schemas.ts";
import { documentHead, placementRow } from "./rows.ts";
import type {
  DocumentKey,
  Placement,
  PlacementChange,
  VerifiedCoordinatorContext,
} from "./types.ts";

const leaseMs = 30_000;
export async function claimPlacement(
  db: MetadataStore,
  context: Extract<VerifiedCoordinatorContext, { kind: "placement" }>,
  document: DocumentKey,
  key: { owner: string; scope: string },
  change: Extract<PlacementChange, { kind: "claim" }>,
): Promise<Placement> {
  if (change.nodeId !== context.nodeId) throw conflict("FORBIDDEN");
  const previousId = await placementRow(db, change.id);
  if (previousId) {
    if (
      previousId.row.owner !== key.owner ||
      previousId.row.document !== document.documentId ||
      previousId.row.scope !== key.scope ||
      previousId.row.node !== context.nodeId ||
      previousId.row.request !== canonical(change)
    )
      throw conflict();
    return previousId.value;
  }
  const old = await documentHead(db, key.owner, document.documentId);
  if (
    (old?.service_epoch ?? null) !== change.expectedServiceEpoch ||
    (old && (old.scope !== key.scope || old.unit !== document.unitId))
  )
    throw conflict("STALE_BASIS");
  const native = await db.first<{ epoch: number }>(
    "SELECT epoch FROM office_native_authority WHERE scope=?",
    [key.scope],
  );
  if (old && native?.epoch !== old.authority_epoch) throw conflict("AUTHORITY_LOST");
  const authorityEpoch = decodeWireSync(Positive)((old?.authority_epoch ?? native?.epoch ?? 0) + 1);
  const serviceEpoch = decodeWireSync(Positive)((old?.service_epoch ?? 0) + 1);
  const next: Placement = {
    ...document,
    id: change.id,
    nodeId: change.nodeId,
    authorityEpoch,
    serviceEpoch,
    until: change.until,
    state: "live",
  };
  const record = db.encode(PlacementSchema, next);
  const oldGuard = old
    ? `EXISTS(SELECT 1 FROM office_coord_documents WHERE owner=? AND document=? AND scope=?
       AND authority_epoch=? AND service_epoch=? AND placement_id=? AND (state='retired' OR placement_until<=${sqlNow}))`
    : "NOT EXISTS(SELECT 1 FROM office_coord_documents WHERE owner=? AND document=?)";
  const oldValues = old
    ? [
        key.owner,
        document.documentId,
        key.scope,
        old.authority_epoch,
        old.service_epoch,
        old.placement_id,
      ]
    : [key.owner, document.documentId];
  const nativeGuard = native
    ? "EXISTS(SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=?)"
    : "NOT EXISTS(SELECT 1 FROM office_native_authority WHERE scope=?)";
  const statements: Statement[] = [];
  if (old)
    statements.push(
      [
        "UPDATE office_coord_placements SET state='retired',record=json_set(record,'$.state','retired') WHERE id=?",
        [old.placement_id],
      ],
      [
        `UPDATE office_coord_turns SET state='expired',version=version+1,
      record=json_set(record,'$.state','expired','$.version',version+1) WHERE id=? AND state='held'`,
        [old.current_turn],
      ],
    );
  statements.push(
    [
      native
        ? "UPDATE office_native_authority SET epoch=?,command_id=NULL,step_id=NULL WHERE scope=? AND epoch=?"
        : "INSERT INTO office_native_authority(scope,epoch,command_id,step_id) VALUES(?,?,NULL,NULL)",
      native ? [authorityEpoch, key.scope, native.epoch] : [key.scope, authorityEpoch],
    ],
    [
      "INSERT INTO office_coord_placements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        next.id,
        key.owner,
        document.documentId,
        document.unitId,
        key.scope,
        next.nodeId,
        authorityEpoch,
        serviceEpoch,
        next.until,
        "live",
        canonical(change),
        record,
      ],
    ],
    [
      `INSERT INTO office_coord_documents VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner,document) DO UPDATE SET authority_epoch=excluded.authority_epoch,
      service_epoch=excluded.service_epoch,placement_id=excluded.placement_id,
      placement_until=excluded.placement_until,state='live',current_turn=NULL`,
      [
        key.owner,
        document.documentId,
        document.unitId,
        key.scope,
        authorityEpoch,
        serviceEpoch,
        next.id,
        next.until,
        "live",
        old?.turn_fence ?? 0,
        null,
      ],
    ],
  );
  await db.write(
    `${oldGuard} AND ${nativeGuard} AND ?>${sqlNow} AND ?>${sqlNow} AND ?<=MIN(?,${sqlNow}+?)
      AND NOT EXISTS(SELECT 1 FROM office_coord_placements WHERE id=?)
      AND EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND unit=?)`,
    [
      ...oldValues,
      key.scope,
      ...(native ? [native.epoch] : []),
      context.notAfter,
      next.until,
      next.until,
      context.notAfter,
      leaseMs,
      next.id,
      key.owner,
      document.documentId,
      document.unitId,
    ],
    statements,
    "BUSY",
  );
  return next;
}
