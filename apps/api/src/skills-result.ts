import type { SkillError, SkillFile } from "./skills-model.ts";

/**
 * Typed outcome for the private skill catalog. Expected domain failures stay
 * explicit instead of leaking storage or transport exceptions to callers.
 */
export type SkillsFailure = {
  readonly ok: false;
  readonly code: SkillError["code"];
  readonly message: string;
  readonly current: SkillFile | null;
  readonly status: number;
};

export type SkillsResult<T> = { readonly ok: true; readonly value: T } | SkillsFailure;

const STATUS: Record<SkillError["code"], number> = {
  invalid_skill: 422,
  skill_exists: 409,
  skill_conflict: 409,
  skill_limit: 507,
  skills_unavailable: 503,
  skill_upload_unknown: 404,
};

export const skillsOk = <T>(value: T): SkillsResult<T> => ({ ok: true, value });

export const skillsFail = (
  code: SkillError["code"],
  message: string,
  current: SkillFile | null = null,
  status?: number,
): SkillsFailure => ({ ok: false, code, message, current, status: status ?? STATUS[code] });
