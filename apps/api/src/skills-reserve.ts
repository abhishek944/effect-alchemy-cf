/**
 * Durable reservation for one upload intent.
 *
 * The reservation row and its immutable version row are written before any
 * bytes leave the request, so an uncertain PUT is always recoverable and
 * sweepable. Same-name conflicts never reserve or publish, and an existing
 * upload id replays only when the full intent matches exactly.
 */
import { skillFilenameKey } from "./skills-manifest.ts";
import {
  MAX_SKILL_INTENTS,
  MAX_SKILLS,
  MAX_SKILL_STORAGE_BYTES,
  MAX_SKILL_VERSIONS,
  type SkillReservation,
  type SkillReservationRequest,
} from "./skills-model.ts";
import {
  skillCancelTombstone,
  skillFileByName,
  skillFileOf,
  skillFileRows,
  skillIntentCount,
  skillReservationOf,
  skillStorageBytes,
  skillUploadRow,
  skillVersionCount,
  type SkillStorage,
} from "./skills-rows.ts";
import { skillsFail, skillsOk, type SkillsResult } from "./skills-result.ts";

export type ReserveSkillInput = {
  readonly storage: SkillStorage;
  readonly scope: string;
  readonly request: SkillReservationRequest;
  readonly now: number;
};

export const reserveSkill = (input: ReserveSkillInput): SkillsResult<SkillReservation> => {
  const { storage, scope, request, now } = input;
  const nameKey = skillFilenameKey(request.filename);
  const existing = skillUploadRow(storage, request.uploadId);
  if (existing !== null) {
    // An expired intent is a permanent tombstone: the id is never reusable for
    // new content, and a late publish for it must not reach a fresh reservation.
    if (existing.state === "expired")
      return skillsFail(
        "skill_upload_unknown",
        "That upload expired. Upload the file again.",
        null,
        404,
      );
    if (existing.state !== "pending" && existing.state !== "published")
      return skillsFail(
        "skills_unavailable",
        "That upload is not available. Upload the file again.",
      );
    const sameIntent =
      existing.filename === request.filename &&
      existing.digest === request.digest &&
      existing.byte_size === request.byteSize &&
      existing.replace_version === request.replaceVersion;
    if (!sameIntent) {
      const bound = skillFileByName(storage, existing.name_key);
      return skillsFail(
        "skill_conflict",
        "This upload id is already bound to a different file.",
        bound === null ? null : skillFileOf(bound),
      );
    }
    return skillsOk(skillReservationOf(scope, existing));
  }
  // A permanent negative tombstone from an explicit cancellation refuses a late
  // reserve before any new intent metadata is created.
  if (skillCancelTombstone(storage, request.uploadId))
    return skillsFail(
      "skill_upload_unknown",
      "That upload was cancelled. Start a new upload.",
      null,
      404,
    );
  const current = skillFileByName(storage, nameKey);
  if (current !== null && request.replaceVersion === null)
    return skillsFail(
      "skill_exists",
      "A skill with this file name already exists. Replace it explicitly or cancel.",
      skillFileOf(current),
    );
  if (current !== null && request.replaceVersion !== current.version)
    return skillsFail(
      "skill_conflict",
      "This skill changed elsewhere. Review the current file and replace it again.",
      skillFileOf(current),
    );
  if (current === null && request.replaceVersion !== null)
    return skillsFail("skill_conflict", "That skill version is no longer current.");
  // Permanent tombstones and markers are bounded by a lifetime intent cap. An
  // existing upload id already returned above, so idempotent replays and
  // receipts keep working at the cap; only a genuinely new intent is refused.
  if (skillIntentCount(storage) >= MAX_SKILL_INTENTS)
    return skillsFail(
      "skill_limit",
      "This library has reached its lifetime upload limit. No further uploads can be reserved.",
    );
  if (current === null && skillFileRows(storage).length >= MAX_SKILLS)
    return skillsFail(
      "skill_limit",
      `You can keep up to ${MAX_SKILLS} skill files. Replace or cancel before adding another.`,
    );
  if (skillVersionCount(storage) >= MAX_SKILL_VERSIONS)
    return skillsFail("skill_limit", "This library has reached its retained version limit.");
  if (skillStorageBytes(storage) + request.byteSize > MAX_SKILL_STORAGE_BYTES)
    return skillsFail("skill_limit", "This library has reached its storage limit.");
  const version = crypto.randomUUID();
  const skillId = current === null ? crypto.randomUUID() : current.id;
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO skill_versions
       (version, skill_id, upload_id, filename, digest, byte_size, state, created_at, published_at, published_revision)
       VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, NULL, NULL)`,
      version,
      skillId,
      request.uploadId,
      request.filename,
      request.digest,
      request.byteSize,
      now,
    );
    storage.sql.exec(
      `INSERT INTO skill_uploads
       (upload_id, filename, name_key, digest, byte_size, replace_version, skill_id, version, state, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
      request.uploadId,
      request.filename,
      nameKey,
      request.digest,
      request.byteSize,
      request.replaceVersion,
      skillId,
      version,
      now,
      now,
    );
  });
  const row = skillUploadRow(storage, request.uploadId);
  return row === null
    ? skillsFail("skills_unavailable", "The skill upload could not be reserved.")
    : skillsOk(skillReservationOf(scope, row));
};
