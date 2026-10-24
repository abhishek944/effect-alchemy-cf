import type { MetadataStore } from "./store.ts";
import { canonical, conflict, sqlNow } from "./store.ts";
import { forbidden } from "./coordinator/context.ts";
import { Channel } from "./native-editor-schema.ts";
import type { EditorContext, JoinedChannel } from "./native-editor-schema.ts";
import { channelRow, editorKey } from "./native-editor-rows.ts";
import { channelBasis } from "./native-editor-basis.ts";

export async function joinChannel(
  db: MetadataStore,
  c: EditorContext,
  viewId: string,
  inputUntil: number,
): Promise<JoinedChannel> {
  const until = db.decode(Channel.fields.until, db.encode(Channel.fields.until, inputUntil));
  const basis = await channelBasis(db, c, viewId),
    previous = await channelRow(db, c);
  if (until > c.notAfter) throw forbidden();
  const value: typeof Channel.Type = {
    id: c.channelId,
    viewId,
    editorId: c.editorId,
    editorEpoch: c.editorEpoch,
    until,
    version: 1,
    state: "live",
    target: c.target,
    principalId: c.principalId,
    sessionEpoch: c.sessionEpoch,
    memberId: c.memberId,
    placementId: c.placementId,
    authorityEpoch: basis.view.authorityEpoch,
    serviceEpoch: basis.view.serviceEpoch,
  };
  const record = db.encode(Channel, value);
  // Membership is session identity, not a write lease. The current basis and every actual
  // write still require live editor/View/placement leases and the final atomic native fence.
  const live = `${basis.sql} AND ?>${sqlNow}`;
  const values = [...basis.values, until];
  if (previous) {
    if (
      canonical(previous.value) !== canonical(value) ||
      !(await db.first(`SELECT 1 WHERE ${live}`, values))
    )
      throw conflict();
    return joined(previous.value);
  }
  await db.write(
    `${live} AND NOT EXISTS(SELECT 1 FROM office_coord_channels WHERE id=?)`,
    [...values, c.channelId],
    [
      [
        "INSERT INTO office_coord_channels VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          c.channelId,
          basis.key.owner,
          c.document.documentId,
          c.document.unitId,
          c.editorId,
          c.editorEpoch,
          viewId,
          c.principalId,
          c.sessionEpoch,
          c.memberId,
          until,
          1,
          "live",
          record,
        ],
      ],
    ],
  );
  return joined(value);
}
function joined(value: typeof Channel.Type): JoinedChannel {
  return {
    id: value.id,
    viewId: value.viewId,
    editorId: value.editorId,
    editorEpoch: value.editorEpoch,
    until: value.until,
    version: value.version,
    state: value.state,
  };
}
/** Expired authority may only revoke its exact captured channel; never renew or fetch content. */
export async function revokeChannel(db: MetadataStore, c: EditorContext): Promise<void> {
  const key = await editorKey(db, c, false),
    previous = await channelRow(db, c);
  if (!previous || previous.value.state === "revoked") return;
  const next: typeof Channel.Type = {
    ...previous.value,
    state: "revoked",
    version: previous.value.version + 1,
  };
  await db.write(
    "EXISTS(SELECT 1 FROM office_coord_channels WHERE id=? AND owner=? AND record=?)",
    [c.channelId, key.owner, previous.row.record],
    [
      [
        "UPDATE office_coord_channels SET state='revoked',version=?,record=? WHERE id=?",
        [next.version, db.encode(Channel, next), c.channelId],
      ],
    ],
  );
}
