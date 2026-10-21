import type { MetadataStore, Statement } from "../store.ts";
import { canonical, conflict, sqlNow } from "../store.ts";
import { requireContext, forbidden } from "./context.ts";
import { turnRow } from "./rows.ts";
import { TurnChangeSchema, TurnSchema } from "./schemas.ts";
import { nativeAdmissionFence } from "./fence.ts";
import type { Turn, TurnChange, VerifiedCoordinatorContext } from "./types.ts";

export async function changeTurn(
  db: MetadataStore,
  context: VerifiedCoordinatorContext,
  id: string,
  expectedVersion: number,
  input: TurnChange,
): Promise<Turn> {
  if (context.kind !== "core") throw forbidden();
  const action = db.decode(TurnChangeSchema, db.encode(TurnChangeSchema, input));
  const key = await requireContext(db, context, context.document);
  const saved = await turnRow(db, id);
  if (
    !saved ||
    saved.row.scope !== key.scope ||
    saved.row.owner !== key.owner ||
    canonical(saved.value.target) !== canonical(context.target) ||
    canonical(saved.value.origin) !== canonical(context.binding) ||
    saved.value.authorizationDigest !== context.authorizationDigest ||
    saved.value.placementId !== context.placementId
  )
    throw forbidden();
  const old = saved.value;
  if (action.kind === "release" && old.state === "expired") return old;
  if (action.kind === "release" && old.state === "released" && old.version === expectedVersion + 1)
    return old;
  if (old.state !== "held" || old.version !== expectedVersion || old.mode !== context.purpose)
    throw conflict("AUTHORITY_LOST");
  const releasing = action.kind === "release";
  const next: Turn = releasing
    ? { ...old, state: "released", version: old.version + 1 }
    : { ...old, deadline: action.until, version: old.version + 1 };
  if (!releasing && next.deadline < old.deadline) throw conflict();
  const native =
    old.mode === "native"
      ? nativeAdmissionFence(
          key.scope,
          {
            turnId: old.id,
            fence: old.fence,
            authorizationDigest: context.authorizationDigest,
            notAfter: context.notAfter,
          },
          old.commandId,
          old.stepId,
          old.authorityEpoch,
          "read",
        )
      : { sql: "1", values: [] };
  const statements: Statement[] = [
    [
      "UPDATE office_coord_turns SET version=?,state=?,deadline=?,record=? WHERE id=? AND version=?",
      [next.version, next.state, next.deadline, db.encode(TurnSchema, next), id, expectedVersion],
    ],
  ];
  if (releasing)
    statements.push(
      [
        "UPDATE office_coord_documents SET current_turn=NULL WHERE owner=? AND document=? AND current_turn=? AND turn_fence=?",
        [key.owner, old.target.documentId, id, old.fence],
      ],
      [
        "UPDATE office_native_authority SET command_id=NULL,step_id=NULL WHERE scope=? AND epoch=? AND command_id=? AND step_id=?",
        [key.scope, old.authorityEpoch, old.commandId, old.stepId],
      ],
    );
  await db.write(
    `?>${sqlNow} AND EXISTS(SELECT 1 FROM office_coord_turns WHERE id=? AND version=? AND record=? AND state='held')
      AND EXISTS(SELECT 1 FROM office_coord_documents WHERE owner=? AND document=? AND scope=?
        AND current_turn=? AND turn_fence=? AND placement_id=? AND authority_epoch=? AND service_epoch=?)
      ${
        releasing
          ? ""
          : `AND (${native.sql}) AND ?>${sqlNow} AND ?>${sqlNow}
        AND ?<=MIN(?,?,${sqlNow}+?)
        AND EXISTS(SELECT 1 FROM office_coord_placements p JOIN office_coord_documents d ON d.placement_id=p.id
          WHERE p.id=? AND p.state='live' AND p.deadline>=? AND d.state='live' AND d.placement_until>=?)`
      }`,
    [
      context.notAfter,
      id,
      expectedVersion,
      saved.row.record,
      key.owner,
      old.target.documentId,
      key.scope,
      id,
      old.fence,
      old.placementId,
      old.authorityEpoch,
      old.serviceEpoch,
      ...(releasing
        ? []
        : [
            ...native.values,
            old.deadline,
            next.deadline,
            next.deadline,
            old.authNotAfter,
            context.notAfter,
            10_000,
            old.placementId,
            next.deadline,
            next.deadline,
          ]),
    ],
    statements,
    "AUTHORITY_LOST",
  );
  return next;
}
