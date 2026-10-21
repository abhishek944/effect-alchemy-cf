/**
 * Publication intent and fencing helpers.
 *
 * These pure reads describe what a reserved upload expects to find at publish
 * time: the same head, the same same-name version and an unchanged reservation.
 * Keeping them separate lets publication re-check them after every await.
 */
import { skillFilenameKey } from "./skills-manifest.ts";
import type { SkillUploadReceipt, SkillVersionRef } from "./skills-model.ts";
import {
  skillFileByName,
  skillFileOf,
  skillHead,
  type SkillFileRow,
  type SkillStorage,
  type SkillUploadRow,
} from "./skills-rows.ts";
import { skillsFail, type SkillsResult } from "./skills-result.ts";

export const receiptOf = (upload: SkillUploadRow): SkillUploadReceipt | null =>
  upload.state === "published" && upload.revision !== null
    ? {
        uploadId: upload.upload_id,
        state: "published",
        revision: upload.revision,
        file: { id: upload.skill_id, filename: upload.filename, version: upload.version },
      }
    : null;

/** Head plus same-name version; any change between reads invalidates the snapshot. */
export const fence = (storage: SkillStorage, nameKey: string): string =>
  `${skillHead(storage) ?? "-"}|${skillFileByName(storage, nameKey)?.version ?? "-"}`;

export const intentFailure = (
  upload: SkillUploadRow,
  current: SkillFileRow | null,
): SkillsResult<SkillUploadReceipt> | null => {
  if (upload.replace_version === null)
    return current === null
      ? null
      : skillsFail(
          "skill_exists",
          "A skill with this file name already exists. Replace it explicitly or cancel.",
          skillFileOf(current),
        );
  if (
    current === null ||
    current.version !== upload.replace_version ||
    current.id !== upload.skill_id
  )
    return skillsFail(
      "skill_conflict",
      "This skill changed elsewhere. Review the current file and replace it again.",
      current === null ? null : skillFileOf(current),
    );
  return null;
};

/** Existing files plus the reserved version, canonicalized for the manifest digest. */
export const nextFiles = (
  rows: readonly SkillFileRow[],
  upload: SkillUploadRow,
): readonly SkillVersionRef[] =>
  [
    ...rows
      .filter((row) => row.name_key !== skillFilenameKey(upload.filename))
      .map((row) => ({
        id: row.id,
        filename: row.filename,
        version: row.version,
        digest: row.digest,
        byteSize: row.byte_size,
      })),
    {
      id: upload.skill_id,
      filename: upload.filename,
      version: upload.version,
      digest: upload.digest,
      byteSize: upload.byte_size,
    },
  ].toSorted((left, right) => left.id.localeCompare(right.id));
