/**
 * Fenced publication of one reserved upload after complete size/digest verification.
 * Rebuild snapshots after awaits; commit only if head, name and reservation match.
 * Concurrent delivery returns the original receipt; claimed/expired input is refused.
 */
import type * as cf from "@cloudflare/workers-types";
import { reportFailure } from "@starter/diagnostics";
import { skillFilenameKey, skillManifestDigest } from "./skills-manifest.ts";
import {
  MAX_SKILLS,
  type SkillManifest,
  type SkillUploadReceipt,
  type SkillVersionRef,
} from "./skills-model.ts";
import { commitPublication } from "./skills-commit.ts";
import { fence, intentFailure, nextFiles, receiptOf } from "./skills-intent.ts";
import { readSkillBytes } from "./skills-objects.ts";
import {
  skillCancelTombstone,
  skillFileByName,
  skillFileRows,
  skillUploadRow,
  skillVersionRow,
  type SkillStorage,
  type SkillUploadRow,
} from "./skills-rows.ts";
import { skillsFail, skillsOk, type SkillsResult } from "./skills-result.ts";

export type PublishSkillInput = {
  readonly storage: SkillStorage;
  readonly scope: string;
  readonly uploadId: string;
  readonly bucket: cf.R2Bucket | undefined;
  readonly now: number;
};

const unavailable = (message: string): SkillsResult<SkillUploadReceipt> =>
  skillsFail("skills_unavailable", message);

const expired = (): SkillsResult<SkillUploadReceipt> =>
  skillsFail("skill_upload_unknown", "That upload expired. Upload the file again.", null, 404);

const PUBLISH_ATTEMPTS = 3;

export const publishSkill = async (
  input: PublishSkillInput,
): Promise<SkillsResult<SkillUploadReceipt>> => {
  const { storage, scope, uploadId, bucket } = input;
  const recovered = (cause: unknown) =>
    reportFailure(cause, {
      component: "skills",
      operation: "publish.reconcile",
      operationId: uploadId,
      event: "application.recovery",
    });
  const afterFailure = (cause: unknown) => {
    try {
      return skillUploadRow(storage, uploadId);
    } catch (secondary) {
      throw new AggregateError([cause], "Skill publication reconciliation failed", {
        cause: secondary,
      });
    }
  };
  const upload = skillUploadRow(storage, uploadId);
  if (upload === null)
    return skillsFail(
      "skill_upload_unknown",
      skillCancelTombstone(storage, uploadId)
        ? "That upload was cancelled. Start a new upload."
        : "That upload is no longer known. Upload the file again.",
      null,
      404,
    );
  if (upload.state === "published") {
    const receipt = receiptOf(upload);
    return receipt === null
      ? unavailable("The skill upload state could not be verified.")
      : skillsOk(receipt);
  }
  if (upload.state === "expired") return expired();
  if (upload.state !== "pending")
    return unavailable("That upload is not ready to publish. Retry the upload.");
  const version = skillVersionRow(storage, upload.version);
  if (version !== null && (version.state === "retiring" || version.state === "expired"))
    return expired();
  if (version === null || version.state !== "reserved")
    return unavailable("That upload is not ready to publish. Retry the upload.");
  if (bucket === undefined) return unavailable("Private skill storage is not configured.");
  const ref: SkillVersionRef = {
    id: version.skill_id,
    filename: version.filename,
    version: version.version,
    digest: version.digest,
    byteSize: version.byte_size,
  };
  try {
    await readSkillBytes(bucket, scope, ref);
  } catch (cause) {
    // The read can fail after another delivery of this exact version already
    // published it. Reconcile the authoritative row before reporting
    // uncertainty; never re-publish and never return another version's receipt.
    const reconciled = afterFailure(cause);
    if (reconciled !== null && reconciled.version === upload.version) {
      if (reconciled.state === "published") {
        const receipt = receiptOf(reconciled);
        if (receipt !== null) {
          recovered(cause);
          return skillsOk(receipt);
        }
      }
      if (reconciled.state === "expired") {
        recovered(cause);
        return expired();
      }
    }
    throw cause;
  }
  /** Returns the settled outcome for a concurrent publisher, or null to proceed. */
  const settled = (row: SkillUploadRow): SkillsResult<SkillUploadReceipt> | null => {
    if (row.state === "published" && row.version === upload.version) {
      const receipt = receiptOf(row);
      return receipt === null
        ? unavailable("The skill upload state could not be verified.")
        : skillsOk(receipt);
    }
    if (row.state === "expired") return expired();
    if (row.state !== "pending" || row.version !== upload.version)
      return unavailable("That upload changed while it was being published.");
    return null;
  };
  const nameKey = skillFilenameKey(upload.filename);
  for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt += 1) {
    const start = skillUploadRow(storage, uploadId);
    if (start === null) return unavailable("That upload changed while it was being published.");
    const startResult = settled(start);
    if (startResult !== null) return startResult;
    const baseFence = fence(storage, nameKey);
    const baseIntent = intentFailure(start, skillFileByName(storage, nameKey));
    if (baseIntent !== null) return baseIntent;
    const files = nextFiles(skillFileRows(storage), start);
    // Concurrent new-name reservations can each pass the reserve-time count;
    // the publication snapshot is the authority, so refuse without touching head.
    if (files.length > MAX_SKILLS)
      return skillsFail(
        "skill_limit",
        `You can keep up to ${MAX_SKILLS} skill files. Replace or cancel before adding another.`,
      );
    const revision = crypto.randomUUID();
    const digest = await skillManifestDigest({ ownerScope: scope, revision, files });
    const fresh = skillUploadRow(storage, uploadId);
    if (fresh === null) return unavailable("That upload changed while it was being published.");
    const freshResult = settled(fresh);
    if (freshResult !== null) return freshResult;
    if (fence(storage, nameKey) !== baseFence) continue;
    const freshIntent = intentFailure(fresh, skillFileByName(storage, nameKey));
    if (freshIntent !== null) return freshIntent;
    const current = skillFileByName(storage, nameKey);
    const manifest: SkillManifest = { ownerScope: scope, revision, files, digest };
    try {
      commitPublication({
        storage,
        upload: fresh,
        uploadId,
        nameKey,
        current,
        manifest,
        now: input.now,
      });
    } catch (cause) {
      const after = afterFailure(cause);
      if (after !== null && after.version === upload.version && after.state === "published") {
        const receipt = receiptOf(after);
        if (receipt !== null) {
          recovered(cause);
          return skillsOk(receipt);
        }
      }
      if (after !== null && after.state === "expired") {
        recovered(cause);
        return expired();
      }
      throw cause;
    }
    const receipt = receiptOf(skillUploadRow(storage, uploadId) ?? upload);
    return receipt === null
      ? unavailable("The skill upload state could not be verified.")
      : skillsOk(receipt);
  }
  return unavailable(
    "The skill library changed while this upload was being published. Retry the upload.",
  );
};
