/**
 * Explicit terminal settlement for one uncertain upload intent.
 *
 * Published uploads are acknowledged unchanged and never mutated. A pending
 * intent is expired in one transaction and only its unpublished reserved version
 * is claimed for retirement, so the existing cleanup writes the permanent marker
 * and releases quota later. A never-seen id receives a minimal permanent negative
 * tombstone inside the same cumulative bound, so a late reserve or publish is
 * refused authoritatively instead of being mistaken for missing.
 */
import { MAX_SKILL_INTENTS, type SkillUploadReceipt } from "./skills-model.ts";
import { receiptOf } from "./skills-intent.ts";
import {
  insertSkillCancelTombstone,
  skillCancelTombstone,
  skillIntentCount,
  skillUploadRow,
  skillVersionRow,
  type SkillStorage,
} from "./skills-rows.ts";
import { skillsFail, skillsOk, type SkillsResult } from "./skills-result.ts";

export type CancelSkillInput = {
  readonly storage: SkillStorage;
  readonly uploadId: string;
  readonly now: number;
};

const expired = (uploadId: string): SkillUploadReceipt => ({ uploadId, state: "expired" });

export const cancelSkillUpload = (input: CancelSkillInput): SkillsResult<SkillUploadReceipt> => {
  const { storage, uploadId, now } = input;
  const upload = skillUploadRow(storage, uploadId);
  if (upload !== null) {
    if (upload.state === "published") {
      const receipt = receiptOf(upload);
      return receipt === null
        ? skillsFail("skills_unavailable", "The skill upload state could not be verified.")
        : skillsOk(receipt);
    }
    if (upload.state === "expired") return skillsOk(expired(uploadId));
    if (upload.state !== "pending")
      return skillsFail(
        "skills_unavailable",
        "That upload is not available. Upload the file again.",
      );
    // The reserved version must belong to this exact intent before any retirement
    // claim. A missing or inconsistent version is not authoritative expired state.
    const version = skillVersionRow(storage, upload.version);
    if (
      version === null ||
      version.state !== "reserved" ||
      version.upload_id !== uploadId ||
      version.skill_id !== upload.skill_id
    )
      return skillsFail(
        "skills_unavailable",
        "That upload could not be retired safely. Retry the cancellation.",
      );
    try {
      storage.transactionSync(() => {
        const retired = storage.sql
          .exec<{ readonly upload_id: string; readonly state: string; readonly version: string }>(
            `UPDATE skill_uploads SET state = 'expired', updated_at = ?
             WHERE upload_id = ? AND state = 'pending'
             RETURNING upload_id, state, version`,
            now,
            uploadId,
          )
          .toArray();
        const retiredRow = retired[0];
        if (
          retired.length !== 1 ||
          retiredRow === undefined ||
          retiredRow.upload_id !== uploadId ||
          retiredRow.state !== "expired" ||
          retiredRow.version !== upload.version
        )
          throw new Error("skill upload cancellation fence lost");
        const claimed = storage.sql
          .exec<{
            readonly version: string;
            readonly upload_id: string;
            readonly skill_id: string;
            readonly state: string;
          }>(
            `UPDATE skill_versions SET state = 'retiring'
             WHERE version = ? AND upload_id = ? AND skill_id = ? AND state = 'reserved'
             RETURNING version, upload_id, skill_id, state`,
            upload.version,
            uploadId,
            upload.skill_id,
          )
          .toArray();
        const claimedRow = claimed[0];
        if (
          claimed.length !== 1 ||
          claimedRow === undefined ||
          claimedRow.version !== upload.version ||
          claimedRow.upload_id !== uploadId ||
          claimedRow.skill_id !== upload.skill_id ||
          claimedRow.state !== "retiring"
        )
          throw new Error("skill version cancellation fence lost");
      });
    } catch {
      return skillsFail(
        "skills_unavailable",
        "That upload could not be retired safely. Retry the cancellation.",
      );
    }
    return skillsOk(expired(uploadId));
  }
  // A repeated cancellation of an existing negative id stays idempotent even at
  // the cumulative cap; only a brand-new negative id can be refused.
  if (skillCancelTombstone(storage, uploadId)) return skillsOk(expired(uploadId));
  if (skillIntentCount(storage) >= MAX_SKILL_INTENTS)
    return skillsFail(
      "skill_limit",
      "This library has reached its lifetime upload limit. No further cancellations can be recorded.",
    );
  storage.transactionSync(() => insertSkillCancelTombstone(storage, uploadId, now));
  return skillsOk(expired(uploadId));
};
