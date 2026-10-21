/**
 * Browser wire types for the private owner Skills library.
 *
 * The API mirror is apps/api/src/skills-model.ts; these types describe exactly
 * the shapes the settings UI consumes. Nothing here carries storage keys,
 * buckets or owner ids, so the browser can never choose its own owner scope.
 */

export type SkillFile = {
  readonly id: string;
  readonly filename: string;
  readonly version: string;
};

/** GET /api/skills[?uploadId=] settles one retained upload intent, read-only. */
export type SkillUploadReceipt =
  | {
      readonly uploadId: string;
      readonly state: "published";
      readonly revision: string;
      readonly file: SkillFile;
    }
  | { readonly uploadId: string; readonly state: "pending" }
  | { readonly uploadId: string; readonly state: "missing" }
  /**
   * Permanent owner-side tombstone, distinct from a never-seen upload id. The
   * owner catalog returns it for expired rows and negative tombstones.
   */
  | { readonly uploadId: string; readonly state: "expired" };

export type SkillList = {
  readonly revision: string;
  readonly files: readonly SkillFile[];
  readonly receipt: SkillUploadReceipt | null;
};

export type SkillErrorCode =
  | "invalid_skill"
  | "skill_exists"
  | "skill_conflict"
  | "skill_limit"
  | "skills_unavailable"
  | "skill_upload_unknown";

export type SkillErrorBody = {
  readonly code: SkillErrorCode;
  readonly message: string;
  readonly current: SkillFile | null;
};

export type PublishedSkillUpload = Extract<SkillUploadReceipt, { state: "published" }>;
