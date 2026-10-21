import { decodeWireSync } from "@starter/office-contract";
import type { MetadataStore, Statement } from "../store.ts";
import { conflict, sqlNow } from "../store.ts";
import { Positive, PlacementSchema } from "./schemas.ts";
import { documentHead, placementRow } from "./rows.ts";
import type {
  DocumentKey,
  Placement,
  PlacementChange,
  VerifiedCoordinatorContext,
} from "./types.ts";

export async function changePlacement(
  db: MetadataStore,
  context: Extract<VerifiedCoordinatorContext, { kind: "placement" }>,
  document: DocumentKey,
  key: { owner: string; scope: string },
  change: Exclude<PlacementChange, { kind: "claim" }>,
): Promise<Placement> {
  const saved = await placementRow(db, change.id);
  if (
    !saved ||
    saved.row.owner !== key.owner ||
    saved.row.document !== document.documentId ||
    saved.row.scope !== key.scope ||
    saved.value.nodeId !== context.nodeId
  )
    throw conflict("FORBIDDEN");
  const old = saved.value;
  if (change.kind === "retire" && old.state === "retired") return old;
  const head = await documentHead(db, key.owner, document.documentId);
  if (
    !head ||
    head.placement_id !== old.id ||
    head.service_epoch !== change.serviceEpoch ||
    old.serviceEpoch !== change.serviceEpoch ||
    old.state !== "live" ||
    head.state !== "live"
  )
    throw conflict("AUTHORITY_LOST");
  const retiring = change.kind === "retire";
  const next: Placement = retiring
    ? {
        ...old,
        state: "retired",
        authorityEpoch: decodeWireSync(Positive)(head.authority_epoch + 1),
        serviceEpoch: decodeWireSync(Positive)(head.service_epoch + 1),
      }
    : { ...old, until: change.until };
  if (!retiring && next.until < old.until) throw conflict();
  const statements: Statement[] = [
    [
      "UPDATE office_coord_placements SET authority_epoch=?,service_epoch=?,deadline=?,state=?,record=? WHERE id=?",
      [
        next.authorityEpoch,
        next.serviceEpoch,
        next.until,
        next.state,
        db.encode(PlacementSchema, next),
        next.id,
      ],
    ],
    [
      `UPDATE office_coord_documents SET authority_epoch=?,service_epoch=?,placement_until=?,state=?,
      current_turn=CASE WHEN ? THEN NULL ELSE current_turn END WHERE owner=? AND document=?`,
      [
        next.authorityEpoch,
        next.serviceEpoch,
        next.until,
        next.state,
        Number(retiring),
        key.owner,
        document.documentId,
      ],
    ],
  ];
  if (retiring)
    statements.push(
      [
        "UPDATE office_native_authority SET epoch=?,command_id=NULL,step_id=NULL WHERE scope=? AND epoch=?",
        [next.authorityEpoch, key.scope, old.authorityEpoch],
      ],
      [
        `UPDATE office_coord_turns SET state='expired',version=version+1,
      record=json_set(record,'$.state','expired','$.version',version+1) WHERE id=? AND state='held'`,
        [head.current_turn],
      ],
    );
  await db.write(
    `?>${sqlNow} AND EXISTS(SELECT 1 FROM office_coord_documents WHERE owner=? AND document=? AND scope=?
      AND placement_id=? AND authority_epoch=? AND service_epoch=? AND state='live')
      AND EXISTS(SELECT 1 FROM office_coord_placements WHERE id=? AND record=?)
      AND EXISTS(SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=?)
      ${retiring ? "" : `AND ?>${sqlNow} AND ?>${sqlNow} AND ?<=MIN(?,${sqlNow}+?)`}`,
    [
      context.notAfter,
      key.owner,
      document.documentId,
      key.scope,
      old.id,
      head.authority_epoch,
      head.service_epoch,
      old.id,
      saved.row.record,
      key.scope,
      old.authorityEpoch,
      ...(retiring ? [] : [old.until, next.until, next.until, context.notAfter, 30_000]),
    ],
    statements,
    "AUTHORITY_LOST",
  );
  return next;
}
