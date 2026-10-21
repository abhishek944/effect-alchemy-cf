import type { ArtifactRef } from "@starter/office-contract";
import type { MetadataStore } from "./store.ts";
import { canonical, conflict, sqlNow } from "./store.ts";
import { artifactEdges, completeRefs } from "./artifacts.ts";
import { documentHead } from "./coordinator/rows.ts";
import { Client, EditorTurn } from "./native-editor-schema.ts";
import type { EditorAdmissionResult, EditorContext } from "./native-editor-schema.ts";
import { channelRow, editorKey, editorTurnRow } from "./native-editor-rows.ts";
import { admissionOf, channelBasis, editorHead, liveEditor } from "./native-editor-basis.ts";
import { editorTurnStatements } from "./native-editor-turn.ts";
import { observeEditor } from "./native-editor-proof.ts";

export async function admitEditor(
  db: MetadataStore,
  c: EditorContext,
  submissionId: string,
  turnId: string,
  input: { readonly sid: string; readonly reqId: number; readonly client: ArtifactRef },
): Promise<EditorAdmissionResult> {
  const client = db.decode(Client, db.encode(Client, input));
  const channel = await channelRow(db, c);
  if (!channel) throw conflict("NOT_FOUND");
  const key = await editorKey(db, c),
    branch = canonical(c.target.scope);
  const old = await db.first<{ id: string; turn_id: string; client_ref: string }>(
    "SELECT id,turn_id,client_ref FROM office_coord_editor_submissions WHERE scope=? AND branch=? AND sid=? AND req_id=?",
    [key.scope, branch, client.sid, client.reqId],
  );
  if (old) {
    if (
      old.id !== submissionId ||
      old.turn_id !== turnId ||
      old.client_ref !== db.encode(Client, client)
    )
      throw conflict();
    const original = await editorTurnRow(db, old.turn_id);
    if (!original) throw conflict("OUTCOME_UNKNOWN");
    return { kind: "observed", observation: await observeEditor(db, c, original.value.origin) };
  }
  const basis = await channelBasis(db, c, channel.value.viewId);
  const head = await documentHead(db, basis.key.owner, c.document.documentId);
  const native = await db.first<{
    epoch: number;
    command_id: string | null;
    step_id: string | null;
  }>("SELECT epoch,command_id,step_id FROM office_native_authority WHERE scope=?", [
    basis.key.scope,
  ]);
  const clock = await db.first<{ now: number }>(`SELECT ${sqlNow} AS now`),
    expectedHead = await editorHead(db, c);
  if (
    !head ||
    !native ||
    !clock ||
    channel.value.state !== "live" ||
    head.scope !== basis.key.scope ||
    head.placement_id !== c.placementId ||
    head.authority_epoch !== native.epoch ||
    head.authority_epoch !== channel.value.authorityEpoch ||
    head.service_epoch !== channel.value.serviceEpoch ||
    client.client.bytes > db.limits.nativeBytes
  )
    throw conflict("AUTHORITY_LOST");
  const authNotAfter = Math.min(c.notAfter, channel.value.until, basis.view.view.expiresAt);
  const turn = db.decode(
    EditorTurn,
    db.encode(EditorTurn, {
      id: turnId,
      version: 1,
      fence: head.turn_fence + 1,
      state: "held",
      mode: "native",
      deadline: Math.min(clock.now + 10_000, authNotAfter, head.placement_until),
      authNotAfter,
      authorizationDigest: c.authorizationDigest,
      placementId: c.placementId,
      principalId: c.principalId,
      sessionEpoch: c.sessionEpoch,
      target: c.target,
      origin: {
        target: c.target,
        authorityEpoch: head.authority_epoch,
        serviceEpoch: head.service_epoch,
        submissionId,
        stepId: crypto.randomUUID(),
        channelId: c.channelId,
        editorId: c.editorId,
        editorEpoch: c.editorEpoch,
        memberId: c.memberId,
        sid: client.sid,
        reqId: client.reqId,
        expectedHead,
      },
    }),
  );
  const complete = completeRefs(db, c.target.owner, [client.client]);
  const target = c.target.scope;
  const nativeHead =
    target.kind === "main"
      ? "EXISTS(SELECT 1 FROM office_native_units WHERE scope=? AND lifecycle='active' AND head=?)"
      : `EXISTS(SELECT 1 FROM office_meta_drafts m JOIN office_native_drafts d ON d.worktree=m.worktree
      JOIN office_native_worktrees w ON w.scope=d.scope AND w.id=d.worktree
      WHERE d.scope=? AND d.head=? AND m.owner=? AND m.id=? AND m.document=?
      AND m.generation=? AND w.generation=m.generation AND w.status='draft' AND d.removed=0)`;
  const headValues = [
    basis.key.scope,
    expectedHead,
    ...(target.kind === "draft"
      ? [basis.key.owner, target.draftId, c.document.documentId, target.generation]
      : []),
  ];
  // A failed/uncertain first INSERT never recovers a dispatch permit by rereading it.
  await db.write(
    `(${basis.sql}) AND (${complete.sql}) AND (${nativeHead}) AND ?>${sqlNow}
    AND EXISTS(SELECT 1 FROM office_coord_channels WHERE id=? AND record=? AND state='live' AND deadline>${sqlNow})
    AND EXISTS(SELECT 1 FROM office_coord_documents d WHERE owner=? AND document=? AND turn_fence=? AND current_turn IS ?
      AND NOT EXISTS(SELECT 1 FROM office_coord_turns t WHERE t.id=d.current_turn AND t.state='held'
        AND t.deadline>${sqlNow} AND t.auth_until>${sqlNow}))
    AND EXISTS(SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=? AND command_id IS ? AND step_id IS ?)
    AND NOT EXISTS(SELECT 1 FROM office_coord_turns WHERE id=? OR (scope=? AND command_id=?))
    AND NOT EXISTS(SELECT 1 FROM office_coord_editor_submissions WHERE id=? OR (scope=? AND branch=? AND sid=? AND req_id=?))`,
    [
      ...basis.values,
      ...complete.values,
      ...headValues,
      turn.deadline,
      c.channelId,
      channel.row.record,
      basis.key.owner,
      c.document.documentId,
      head.turn_fence,
      head.current_turn,
      basis.key.scope,
      native.epoch,
      native.command_id,
      native.step_id,
      turnId,
      basis.key.scope,
      submissionId,
      submissionId,
      basis.key.scope,
      branch,
      client.sid,
      client.reqId,
    ],
    [
      ...editorTurnStatements(db, c, head, turn, canonical({ submissionId, turnId, client })),
      [
        "INSERT INTO office_coord_editor_submissions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          submissionId,
          basis.key.scope,
          branch,
          client.sid,
          client.reqId,
          c.channelId,
          c.editorId,
          c.editorEpoch,
          turnId,
          "admitted",
          db.encode(Client, client),
          null,
          null,
          null,
        ],
      ],
      ...artifactEdges(db, c.target.owner, "editor-client", submissionId, [client.client]),
    ],
    "BUSY",
  );
  await liveEditor(db, c, turn.origin);
  return { kind: "admitted", permit: turn.origin, admission: admissionOf(turn) };
}
