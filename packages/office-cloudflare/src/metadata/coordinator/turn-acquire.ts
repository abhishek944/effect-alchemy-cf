import type { NativeTarget, SerialAdmission } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "../store.ts";
import { canonical, conflict, sqlNow } from "../store.ts";
import { requireContext, forbidden } from "./context.ts";
import { documentHead, placementRow, turnRow } from "./rows.ts";
import { Admission, CoreBindingSchema, Target, TurnSchema } from "./schemas.ts";
import { validatePurpose } from "./purpose.ts";
import { admissionBasis } from "./basis.ts";
import type { Turn, VerifiedCoordinatorContext } from "./types.ts";

export async function acquireCore(
  db: MetadataStore,
  context: VerifiedCoordinatorContext,
  id: string,
  placementId: string,
  inputTarget: NativeTarget,
  inputRequest: SerialAdmission,
): Promise<Turn> {
  if (context.kind !== "core" || context.placementId !== placementId) throw forbidden();
  const target = db.decode(Target, db.encode(Target, inputTarget));
  const request = db.decode(Admission, db.encode(Admission, inputRequest));
  if (
    request.purpose !== context.purpose ||
    request.operationId !== context.binding.operationId ||
    canonical(target) !== canonical(context.target)
  )
    throw forbidden();
  const key = await requireContext(db, context, {
    owner: target.owner,
    documentId: target.documentId,
    unitId: target.unitId,
  });
  const identity = canonical({ placementId, target, admission: request });
  const previous = await turnRow(db, id);
  if (previous) {
    if (
      previous.row.owner !== key.owner ||
      previous.row.scope !== key.scope ||
      previous.row.request !== identity ||
      previous.value.authorizationDigest !== context.authorizationDigest ||
      canonical(previous.value.origin) !== canonical(context.binding)
    )
      throw conflict();
    // Observation of this exact attempt, NOT a fresh dispatch/token or a deadline extension.
    return previous.value;
  }
  const plan = await validatePurpose(db, context, target, request);
  const head = await documentHead(db, key.owner, target.documentId);
  const placement = await placementRow(db, placementId);
  if (
    !head ||
    !placement ||
    head.scope !== key.scope ||
    head.placement_id !== placementId ||
    placement.row.scope !== key.scope ||
    placement.value.authorityEpoch !== head.authority_epoch ||
    placement.value.serviceEpoch !== head.service_epoch ||
    placement.value.state !== "live" ||
    placement.value.until !== head.placement_until ||
    head.state !== "live"
  )
    throw conflict("AUTHORITY_LOST");
  const native = await db.first<{
    epoch: number;
    command_id: string | null;
    step_id: string | null;
  }>("SELECT epoch,command_id,step_id FROM office_native_authority WHERE scope=?", [key.scope]);
  if (!native || native.epoch !== head.authority_epoch) throw conflict("AUTHORITY_LOST");
  const clock = await db.first<{ now: number }>(`SELECT ${sqlNow} AS now`);
  if (!clock) throw conflict();
  const next: Turn = {
    id,
    version: 1,
    fence: head.turn_fence + 1,
    target,
    placementId,
    commandId: request.operationId,
    stepId: crypto.randomUUID(),
    authorityEpoch: head.authority_epoch,
    serviceEpoch: head.service_epoch,
    deadline: Math.min(clock.now + 10_000, plan.authUntil, placement.value.until),
    authNotAfter: plan.authUntil,
    mode: request.purpose,
    state: "held",
    origin: db.decode(CoreBindingSchema, db.encode(CoreBindingSchema, context.binding)),
    authorizationDigest: context.authorizationDigest,
    admission: request,
    nativePlan: plan.nativePlan,
  };
  const record = db.encode(TurnSchema, next),
    basis = admissionBasis(db, target, request, plan.nativePlan);
  const statements: Statement[] = [
    [
      `UPDATE office_coord_turns SET state='expired',version=version+1,
      record=json_set(record,'$.state','expired','$.version',version+1) WHERE id=? AND state='held'`,
      [head.current_turn],
    ],
    [
      `INSERT INTO office_coord_turns(id,owner,document,scope,placement_id,command_id,step_id,authority_epoch,
      service_epoch,version,fence,mode,state,deadline,auth_until,authorization_digest,subject,request,record)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        key.owner,
        target.documentId,
        key.scope,
        placementId,
        next.commandId,
        next.stepId,
        next.authorityEpoch,
        next.serviceEpoch,
        next.version,
        next.fence,
        next.mode,
        next.state,
        next.deadline,
        next.authNotAfter,
        next.authorizationDigest,
        "core",
        identity,
        record,
      ],
    ],
    [
      "UPDATE office_coord_documents SET current_turn=?,turn_fence=? WHERE owner=? AND document=?",
      [next.id, next.fence, key.owner, target.documentId],
    ],
    [
      "UPDATE office_native_authority SET command_id=?,step_id=? WHERE scope=? AND epoch=?",
      [next.commandId, next.stepId, key.scope, next.authorityEpoch],
    ],
  ];
  await db.write(
    `?>${sqlNow} AND ?>${sqlNow} AND EXISTS(SELECT 1 FROM office_coord_documents d
      JOIN office_coord_placements p ON p.id=d.placement_id
      WHERE d.owner=? AND d.document=? AND d.scope=? AND d.placement_id=? AND d.state='live'
        AND d.authority_epoch=? AND d.service_epoch=? AND d.turn_fence=? AND d.current_turn IS ?
        AND d.placement_until>${sqlNow} AND p.record=? AND p.state='live' AND p.deadline>=?
        AND NOT EXISTS(SELECT 1 FROM office_coord_turns t WHERE t.id=d.current_turn AND t.state='held'
          AND t.deadline>${sqlNow} AND t.auth_until>${sqlNow}))
      AND EXISTS(SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=? AND command_id IS ? AND step_id IS ?)
      AND NOT EXISTS(SELECT 1 FROM office_coord_turns WHERE id=?) AND (${plan.predicate.sql}) AND (${basis.sql})
      ${request.purpose === "native" ? "AND NOT EXISTS(SELECT 1 FROM office_meta_editors WHERE owner=? AND document=? AND state IN ('active','draining','unclean'))" : ""}`,
    [
      context.notAfter,
      next.deadline,
      key.owner,
      target.documentId,
      key.scope,
      placementId,
      head.authority_epoch,
      head.service_epoch,
      head.turn_fence,
      head.current_turn,
      placement.row.record,
      next.deadline,
      key.scope,
      native.epoch,
      native.command_id,
      native.step_id,
      next.id,
      ...plan.predicate.values,
      ...basis.values,
      ...(request.purpose === "native" ? [key.owner, target.documentId] : []),
    ],
    statements,
    "BUSY",
  );
  return next;
}
