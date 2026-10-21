import type { PredicateSQL } from "../native-fence.ts";
import type { NativeAdmission } from "../../native/types.ts";
import { canonical, sqlNow } from "../store.ts";

export type CapturedTurn = NativeAdmission;
const live = `t.state='held' AND d.state='live' AND p.state='live'
  AND d.current_turn=t.id AND d.turn_fence=t.fence AND d.scope=t.scope
  AND d.placement_id=t.placement_id AND p.id=t.placement_id
  AND p.owner=t.owner AND p.document=t.document AND p.scope=t.scope
  AND d.authority_epoch=t.authority_epoch AND p.authority_epoch=t.authority_epoch
  AND d.service_epoch=t.service_epoch AND p.service_epoch=t.service_epoch
  AND t.deadline>${sqlNow} AND t.auth_until>${sqlNow}
  AND d.placement_until>${sqlNow} AND p.deadline>${sqlNow}`;
const core = `EXISTS(SELECT 1 FROM office_meta_operations o
  WHERE o.owner=t.owner AND o.id=t.command_id AND o.document=t.document
  AND json_extract(o.record,'$.unitId')=d.unit
  AND o.phase NOT IN ('confirmed','failed-before-submit','conflict','cancelled-before-dispatch')
  AND json_extract(o.record,'$.actor.expiresAt')>${sqlNow}
  AND ((json_extract(t.record,'$.origin.kind')='operation'
    AND json_extract(o.record,'$.intentDigest')=json_extract(t.record,'$.origin.intentDigest')
    AND json_extract(o.record,'$.lineageDigest')=json_extract(t.record,'$.origin.lineageDigest'))
   OR (json_extract(t.record,'$.origin.kind')='new-merge'
    AND json_extract(o.record,'$.intent.kind')='merge'
    AND json_extract(o.record,'$.actor.capability')='human'
    AND json_extract(o.record,'$.actor.principalId')=json_extract(t.record,'$.origin.principalId')
    AND json_extract(o.record,'$.actor.sessionEpoch')=json_extract(t.record,'$.origin.sessionEpoch')
    AND json_extract(o.record,'$.intent.input.approvalOperationId')=json_extract(t.record,'$.origin.approvalOperationId')))
  AND CASE WHEN json_extract(o.record,'$.intent.kind')='merge' THEN EXISTS(
    SELECT 1 FROM office_meta_barriers b JOIN office_meta_approvals a
      ON a.owner=b.owner AND a.id=json_extract(b.record,'$.approvalOperationId')
    WHERE b.owner=t.owner AND b.document=t.document AND b.operation=t.command_id
      AND json_extract(b.record,'$.fingerprint')=json_extract(t.record,'$.admission.reviewFingerprint')
      AND a.consumed_by=t.command_id
      AND json_extract(a.record,'$.fingerprint')=json_extract(t.record,'$.admission.reviewFingerprint')
      AND json_extract(a.record,'$.expiresAt')>${sqlNow})
   ELSE NOT EXISTS(SELECT 1 FROM office_meta_barriers b WHERE b.owner=t.owner AND b.document=t.document) END)
  AND NOT EXISTS(SELECT 1 FROM office_meta_editors e WHERE e.owner=t.owner AND e.document=t.document
    AND e.state IN ('active','draining','unclean'))`;
const editor = `EXISTS(SELECT 1 FROM office_coord_channels c
  JOIN office_meta_editors e ON e.owner=c.owner AND e.id=c.editor_id
  JOIN office_meta_editor_epochs x ON x.owner=e.owner AND x.document=e.document AND x.branch=e.branch
  JOIN office_meta_views v ON v.owner=e.owner AND v.id=c.view_id
  JOIN office_coord_editor_submissions s ON s.id=t.command_id AND s.turn_id=t.id
  WHERE c.id=t.channel_id AND c.owner=t.owner AND c.document=t.document AND c.unit=d.unit
    AND c.state='live' AND c.deadline>${sqlNow}
    AND e.id=t.editor_id AND e.epoch=t.editor_epoch AND x.epoch=e.epoch
    AND c.editor_epoch=e.epoch AND e.state='active' AND e.expires>${sqlNow}
    AND json_extract(e.record,'$.editor.view.mode')='edit'
    AND json_extract(e.record,'$.editor.view.id')=v.id
    AND v.expires>${sqlNow} AND json_extract(v.record,'$.authorityEpoch')=t.authority_epoch
    AND json_extract(v.record,'$.serviceEpoch')=t.service_epoch
    AND json_extract(e.record,'$.editor.view')=json_extract(v.record,'$.view')
    AND json_extract(t.record,'$.principalId')=c.principal
    AND json_extract(t.record,'$.sessionEpoch')=c.session_epoch
    AND json_extract(c.record,'$.principalId')=c.principal
    AND json_extract(c.record,'$.sessionEpoch')=c.session_epoch
    AND json_extract(c.record,'$.memberId')=c.member_id
    AND json_extract(v.record,'$.target')=json_extract(t.record,'$.target')
    AND json_extract(c.record,'$.target')=json_extract(t.record,'$.target')
    AND c.member_id=json_extract(t.record,'$.origin.memberId')
    AND s.channel_id=c.id AND s.editor_id=e.id AND s.editor_epoch=e.epoch
    AND s.sid=json_extract(t.record,'$.origin.sid') AND s.req_id=json_extract(t.record,'$.origin.reqId')
    AND s.state IN ('admitted','staged','prepared','unknown'))`;

/** Fixed SQL only. Never accepts arbitrary caller predicates or claims a remote precheck is final. */
export function nativeAdmissionFence(
  scope: string,
  access: CapturedTurn,
  commandId: string,
  stepId: string,
  epoch: number,
  effect: "read" | "stage",
): PredicateSQL {
  return {
    sql: `EXISTS(SELECT 1 FROM office_coord_turns t
      JOIN office_coord_documents d ON d.owner=t.owner AND d.document=t.document
      JOIN office_coord_placements p ON p.id=t.placement_id CROSS JOIN (SELECT ? AS bound) a
      WHERE t.scope=json_extract(a.bound,'$[0]') AND t.id=json_extract(a.bound,'$[1]')
      AND t.fence=json_extract(a.bound,'$[2]') AND t.command_id=json_extract(a.bound,'$[3]')
      AND t.step_id=json_extract(a.bound,'$[4]') AND t.authority_epoch=json_extract(a.bound,'$[5]')
      AND t.authorization_digest=json_extract(a.bound,'$[6]') AND json_extract(a.bound,'$[7]')>${sqlNow}
      AND t.mode='native' AND ${live}
      ${effect === "stage" ? "AND (t.subject='editor' OR json_extract(t.record,'$.nativePlan') IN ('fresh','newborn-unit'))" : ""}
      AND ((t.subject='core' AND ${core}) OR (t.subject='editor' AND ${editor})))`,
    values: [
      canonical([
        scope,
        access.turnId,
        access.fence,
        commandId,
        stepId,
        epoch,
        access.authorizationDigest,
        access.notAfter,
      ]),
    ],
  };
}

/** Acquiring an editor must not slip between a Core turn's early check and final publication. */
export function editorAdmissionFence(
  owner: string,
  document: string,
  editorId: string | null,
): PredicateSQL {
  return {
    sql: `NOT EXISTS(SELECT 1 FROM office_coord_documents d JOIN office_coord_turns t ON t.id=d.current_turn
      JOIN office_coord_placements p ON p.id=t.placement_id
      WHERE d.owner=? AND d.document=? AND t.mode='native' AND ${live}
        AND NOT(t.subject='editor' AND t.editor_id IS ?))`,
    values: [owner, document, editorId],
  };
}
