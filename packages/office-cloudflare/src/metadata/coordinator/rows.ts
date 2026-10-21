import type { MetadataStore } from "../store.ts";
import { conflict } from "../store.ts";
import { PlacementSchema, TurnSchema } from "./schemas.ts";
import type { Placement, Turn } from "./types.ts";

export interface DocumentHead {
  owner: string;
  document: string;
  unit: string;
  scope: string;
  authority_epoch: number;
  service_epoch: number;
  placement_id: string;
  placement_until: number;
  state: "live" | "retired";
  turn_fence: number;
  current_turn: string | null;
}
export interface StoredPlacement {
  id: string;
  owner: string;
  document: string;
  unit: string;
  scope: string;
  node: string;
  authority_epoch: number;
  service_epoch: number;
  deadline: number;
  state: "live" | "retired";
  request: string;
  record: string;
}
export interface StoredTurn {
  id: string;
  owner: string;
  document: string;
  scope: string;
  placement_id: string;
  command_id: string;
  step_id: string;
  authority_epoch: number;
  service_epoch: number;
  version: number;
  fence: number;
  mode: Turn["mode"];
  state: Turn["state"];
  deadline: number;
  auth_until: number;
  authorization_digest: string;
  subject: "core" | "editor";
  editor_id: string | null;
  editor_epoch: number | null;
  channel_id: string | null;
  request: string;
  record: string;
}
export const documentHead = (db: MetadataStore, owner: string, document: string) =>
  db.first<DocumentHead>("SELECT * FROM office_coord_documents WHERE owner=? AND document=?", [
    owner,
    document,
  ]);
export async function placementRow(
  db: MetadataStore,
  id: string,
): Promise<{
  row: StoredPlacement;
  value: Placement;
} | null> {
  const row = await db.first<StoredPlacement>("SELECT * FROM office_coord_placements WHERE id=?", [
    id,
  ]);
  if (!row) return null;
  const value = db.decode(PlacementSchema, row.record);
  if (
    value.id !== row.id ||
    value.documentId !== row.document ||
    value.unitId !== row.unit ||
    db.owner(value.owner) !== row.owner ||
    db.native(value.owner, value.documentId, value.unitId) !== row.scope ||
    value.nodeId !== row.node ||
    value.authorityEpoch !== row.authority_epoch ||
    value.serviceEpoch !== row.service_epoch ||
    value.until !== row.deadline ||
    value.state !== row.state
  )
    throw conflict();
  return { row, value };
}
export async function turnRow(
  db: MetadataStore,
  id: string,
): Promise<{ row: StoredTurn; value: Turn } | null> {
  const row = await db.first<StoredTurn>("SELECT * FROM office_coord_turns WHERE id=?", [id]);
  if (!row) return null;
  const value = db.decode(TurnSchema, row.record),
    target = value.target;
  if (
    value.id !== row.id ||
    db.owner(target.owner) !== row.owner ||
    target.documentId !== row.document ||
    db.native(target.owner, target.documentId, target.unitId) !== row.scope ||
    value.placementId !== row.placement_id ||
    value.commandId !== row.command_id ||
    value.stepId !== row.step_id ||
    value.authorityEpoch !== row.authority_epoch ||
    value.serviceEpoch !== row.service_epoch ||
    value.version !== row.version ||
    value.fence !== row.fence ||
    value.mode !== row.mode ||
    value.state !== row.state ||
    value.deadline !== row.deadline ||
    value.authNotAfter !== row.auth_until ||
    value.authorizationDigest !== row.authorization_digest ||
    row.subject !== "core"
  )
    throw conflict();
  return { row, value };
}
