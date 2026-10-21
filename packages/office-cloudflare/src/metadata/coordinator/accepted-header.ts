import type { NativeStatement } from "../../native/database.ts";
import type {
  NativeAdmission,
  NativeFence,
  NativePreparedWrite,
  NativeValueRef,
} from "../../native/types.ts";
import { NativeStorageError } from "../../native/types.ts";
import { valueFingerprint } from "../../native/value-proofs.ts";
import { readValue } from "../../native/ref-shapes.ts";
import { canonical } from "../store.ts";

/** New strict receipt association only. No native body/R2 read, old slot mutation or scalar supplied by callers. */
export async function acceptedHeader(
  scope: string,
  fence: NativeFence,
  action: string,
  fingerprint: string,
  prepared: NativePreparedWrite,
  admission: NativeAdmission | undefined,
  input: NativeValueRef | undefined,
): Promise<{
  condition: string;
  values: readonly string[];
  statements: readonly NativeStatement[];
}> {
  if (!admission) return { condition: "1", values: [], statements: [] };
  const content =
    action === "create-main" ||
    ["create-draft:", "snapshot:", "main-change:", "draft-change:"].some((prefix) =>
      action.startsWith(prefix),
    );
  if (!input) {
    if (content) throw new NativeStorageError("SCOPE", "Exact original content value is required");
    return { condition: "1", values: [], statements: [] };
  }
  const value = readValue(input);
  if (value.kind === "block")
    throw new NativeStorageError("CONTENT", "Accepted publication requires an owning value");
  const hash = await valueFingerprint(value);
  const tuple = [
    scope,
    fence.commandID,
    fence.stepID,
    action,
    prepared.writeId,
    prepared.payloadDigest,
    fingerprint,
    fence.epoch,
    hash,
    value.kind,
    fence.draft?.worktreeID ?? null,
  ];
  return {
    condition: `EXISTS(SELECT 1 FROM office_native_values v CROSS JOIN (SELECT ? AS b) a
      WHERE v.scope=json_extract(a.b,'$[0]') AND v.value_hash=json_extract(a.b,'$[8]')
        AND v.kind=json_extract(a.b,'$[9]') AND json_extract(v.header,'$.kind')=v.kind
        AND json_extract(v.header,'$.unitID')=json_extract(json_extract(a.b,'$[0]'),'$[3]')
        AND json_extract(v.header,'$.type') IN (1,2,3)
        AND json_type(v.header,'$.revision')='integer' AND json_extract(v.header,'$.revision')>0
        AND json_extract(v.header,'$.revision')<=9007199254740991
        AND CASE
          WHEN json_extract(a.b,'$[3]') LIKE 'main-change:%' THEN v.kind='changeset'
            AND json_extract(a.b,'$[3]')='main-change:'||json_extract(v.header,'$.revision')
          WHEN json_extract(a.b,'$[3]') LIKE 'draft-change:%' THEN v.kind='changeset'
            AND json_extract(a.b,'$[3]')='draft-change:'||json_extract(a.b,'$[10]')||':'||json_extract(v.header,'$.revision')
          WHEN json_extract(a.b,'$[3]') LIKE 'snapshot:%' THEN v.kind='snapshot'
            AND json_extract(a.b,'$[3]')='snapshot:'||json_extract(v.header,'$.revision')
          ELSE v.kind='snapshot' END
        AND NOT EXISTS(SELECT 1 FROM office_coord_accepted_headers h WHERE h.scope=v.scope
          AND h.command_id=json_extract(a.b,'$[1]') AND h.step_id=json_extract(a.b,'$[2]')
          AND h.action=json_extract(a.b,'$[3]')))`,
    values: [canonical(tuple)],
    statements: [
      [
        `INSERT INTO office_coord_accepted_headers
      SELECT ?,?,?,?,?,?,?,?,value_hash FROM office_native_values WHERE scope=? AND value_hash=?`,
        [
          scope,
          fence.commandID,
          fence.stepID,
          action,
          prepared.writeId,
          prepared.payloadDigest,
          fingerprint,
          fence.epoch,
          scope,
          hash,
        ],
      ],
    ],
  };
}
