/**
 * Classification of one dispatched Skills POST.
 *
 * Once the request has left the browser, any parse/validation/transport/identity
 * failure is uncertain: the server may already have committed. Only a typed
 * domain rejection can retire an intent, and the tombstoned-upload 404 is the
 * one terminal expiry signal the current API provides after dispatch.
 */
import { SkillsApiError, skillsErrorMessage, uploadSkill } from "./skills-api";
import type { PublishedSkillUpload, SkillFile } from "./skills-types";
import { skillFilenameKey } from "./skills-validate";

export type SkillPublicationOutcome =
  | { readonly kind: "published"; readonly receipt: PublishedSkillUpload }
  | {
      readonly kind: "conflict";
      readonly stale: boolean;
      readonly current: SkillFile | null;
      readonly message: string;
    }
  | { readonly kind: "expired"; readonly message: string }
  | { readonly kind: "uncertain"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export async function publishSkill(input: {
  file: File;
  filename: string;
  uploadId: string;
  replaceVersion: string | null;
}): Promise<SkillPublicationOutcome> {
  let receipt: PublishedSkillUpload;
  try {
    receipt = await uploadSkill(input);
  } catch (cause) {
    if (cause instanceof SkillsApiError) {
      if (cause.code === "skill_upload_unknown") {
        return { kind: "expired", message: cause.message };
      }
      if (cause.code === "skill_exists" || cause.code === "skill_conflict") {
        return {
          kind: "conflict",
          stale: cause.code === "skill_conflict",
          current: cause.current,
          message: cause.message,
        };
      }
      if (cause.code === null || cause.code === "skills_unavailable") {
        return { kind: "uncertain", message: cause.message };
      }
      return { kind: "failed", message: cause.message };
    }
    return { kind: "uncertain", message: skillsErrorMessage(cause) };
  }
  if (
    receipt.uploadId !== input.uploadId ||
    skillFilenameKey(receipt.file.filename) !== skillFilenameKey(input.filename)
  ) {
    return {
      kind: "uncertain",
      message: "The server acknowledged a different upload. Check skills.",
    };
  }
  return { kind: "published", receipt };
}
