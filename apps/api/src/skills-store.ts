/**
 * Private owner skill library: reservations, immutable manifests and reads.
 *
 * One instance per owner catalog serializes naming, revision, quota and upload
 * receipts. The initial empty revision "0" is a verified stored manifest, never
 * a fallback for unavailable storage, and every read re-verifies owner scope and
 * the parent-owned manifest digest before returning files to a caller.
 */
import type * as cf from "@cloudflare/workers-types";
import {
  type SkillList,
  type SkillManifest,
  type SkillReservation,
  type SkillReservationRequest,
  type SkillUploadReceipt,
  type SkillVersionRef,
} from "./skills-model.ts";
import { skillManifestDigest, verifySkillManifest } from "./skills-manifest.ts";
import { readSkillManifest } from "./skills-manifests.ts";
import { cancelSkillUpload } from "./skills-cancel.ts";
import { cleanupSkillVersions } from "./skills-cleanup.ts";
import { publishSkill } from "./skills-publish.ts";
import { reserveSkill } from "./skills-reserve.ts";
import {
  ensureSkillSchema,
  skillCancelTombstone,
  skillHead,
  skillReceiptOf,
  skillRefOfVersion,
  skillUploadRow,
  skillVersionRow,
  type SkillStorage,
} from "./skills-rows.ts";
import { skillsFail, skillsOk, type SkillsResult } from "./skills-result.ts";

const INITIAL_REVISION = "0";

export class SkillsCatalog {
  private readonly storage: SkillStorage;
  private readonly scope: string;

  constructor(options: { readonly storage: SkillStorage; readonly scope: string }) {
    this.storage = options.storage;
    this.scope = options.scope;
    ensureSkillSchema(this.storage);
  }

  /** Seeds the verified empty revision once; concurrent callers cannot race it. */
  private async ensure(): Promise<void> {
    if (skillHead(this.storage) !== null) return;
    const revision = INITIAL_REVISION;
    const digest = await skillManifestDigest({ ownerScope: this.scope, revision, files: [] });
    const manifest: SkillManifest = { ownerScope: this.scope, revision, files: [], digest };
    this.storage.transactionSync(() => {
      if (skillHead(this.storage) !== null) return;
      this.storage.sql.exec(
        `INSERT INTO skill_manifests (revision, document, created_at) VALUES (?, ?, ?)`,
        revision,
        JSON.stringify(manifest),
        Date.now(),
      );
      this.storage.sql.exec(`INSERT INTO skill_head (id, revision) VALUES (1, ?)`, revision);
    });
  }

  private async verifiedManifest(revision: string): Promise<SkillManifest | null> {
    const manifest = readSkillManifest(this.storage, revision);
    if (manifest === null) return null;
    return (await verifySkillManifest(manifest, this.scope)) ? manifest : null;
  }

  async list(uploadId: string | null): Promise<SkillsResult<SkillList>> {
    await this.ensure();
    const revision = skillHead(this.storage);
    if (revision === null)
      return skillsFail("skills_unavailable", "The skill library is unavailable.");
    const manifest = await this.verifiedManifest(revision);
    if (manifest === null)
      return skillsFail("skills_unavailable", "The skill library could not be verified.");
    let receipt: SkillUploadReceipt | null = null;
    if (uploadId !== null) {
      const row = skillUploadRow(this.storage, uploadId);
      if (row === null)
        receipt = skillCancelTombstone(this.storage, uploadId)
          ? { uploadId, state: "expired" }
          : { uploadId, state: "missing" };
      else {
        const candidate = skillReceiptOf(row);
        if (candidate === null)
          return skillsFail("skills_unavailable", "The skill upload state could not be verified.");
        receipt = candidate;
      }
    }
    return skillsOk({
      revision: manifest.revision,
      files: manifest.files.map(({ id, filename, version }) => ({ id, filename, version })),
      receipt,
    });
  }

  async snapshot(revision: string | null): Promise<SkillsResult<SkillManifest>> {
    await this.ensure();
    const wanted = revision ?? skillHead(this.storage);
    if (wanted === null)
      return skillsFail("skills_unavailable", "The skill library is unavailable.");
    const manifest = await this.verifiedManifest(wanted);
    if (manifest === null || manifest.revision !== wanted)
      return skillsFail(
        "skills_unavailable",
        "That skill library revision is not available.",
        null,
        404,
      );
    return skillsOk(manifest);
  }

  reserve(request: SkillReservationRequest, now: number): SkillsResult<SkillReservation> {
    return reserveSkill({ storage: this.storage, scope: this.scope, request, now });
  }

  /** Explicit settlement: published is acknowledged, pending/never-seen expire. */
  cancel(uploadId: string, now: number): SkillsResult<SkillUploadReceipt> {
    return cancelSkillUpload({ storage: this.storage, uploadId, now });
  }

  async publish(
    uploadId: string,
    bucket: cf.R2Bucket | undefined,
    now: number,
  ): Promise<SkillsResult<SkillUploadReceipt>> {
    await this.ensure();
    return publishSkill({ storage: this.storage, scope: this.scope, uploadId, bucket, now });
  }

  file(id: string, version: string): SkillsResult<SkillVersionRef> {
    const row = skillVersionRow(this.storage, version);
    if (row === null || row.state !== "published" || row.skill_id !== id)
      return skillsFail("skills_unavailable", "That skill file is not available.", null, 404);
    return skillsOk(skillRefOfVersion(row));
  }

  async cleanup(bucket: cf.R2Bucket | undefined, now: number): Promise<void> {
    if (bucket === undefined) return;
    await cleanupSkillVersions({ storage: this.storage, scope: this.scope, bucket, now });
  }
}
