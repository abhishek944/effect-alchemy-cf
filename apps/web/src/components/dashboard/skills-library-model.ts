/**
 * Shared display types and pure decisions for the Skills settings surface.
 * Nothing here performs I/O, so both the remote list and the upload queue can
 * depend on it without a cycle.
 */
import type { SkillCandidate } from "@/lib/skills-file";
import type { SkillUploadIntent } from "@/lib/skills-attempt";
import type { SkillFile, SkillUploadReceipt } from "@/lib/skills-types";

export type SkillsPhase = "loading" | "ready" | "error";
export type SkillNoticeAction = "check" | "refresh" | "upload" | "choose" | null;
export type SkillNoticeRun = Exclude<SkillNoticeAction, "choose" | null>;

export type SkillNotice = {
  readonly title: string;
  readonly message: string;
  readonly action: SkillNoticeAction;
};

/** One explicit same-name decision; `stale` means the catalog moved on. */
export type SkillConflict = {
  readonly file: File;
  readonly candidate: SkillCandidate;
  readonly current: SkillFile;
  readonly stale: boolean;
};

export type SkillDownloadFailure = {
  readonly file: SkillFile;
  readonly message: string;
};

/** A File still held in this tab for one retained intent. */
export type HeldUpload = {
  readonly file: File;
  readonly candidate: SkillCandidate;
};

/** A definitive expiry may retry once with a fresh id while its File is held. */
export type RetryUpload = HeldUpload & {
  readonly replaceVersion: string | null;
};

/** The oldest retained intent a recovery notice can cancel by exact id. */
export type SkillUnsettled = {
  readonly uploadId: string;
  readonly filename: string;
};

/** Outcome of the single list-read owner; every list write passes through it. */
export type SkillListReadOutcome =
  | { readonly kind: "receipt"; readonly receipt: SkillUploadReceipt }
  | { readonly kind: "applied" }
  | { readonly kind: "invalid" }
  | { readonly kind: "superseded" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * The only list read/write owner. It aborts the previous request, so a late
 * refresh from an earlier publication can never overwrite a newer list; the
 * mode decides whether a failure is announced and by whom.
 */
export type SkillListRead = (
  uploadId: string | undefined,
  mode: "load" | "check" | "quiet" | "refresh",
) => Promise<SkillListReadOutcome>;

export type SkillsLibrary = {
  readonly phase: SkillsPhase;
  readonly files: readonly SkillFile[];
  readonly loadError: string;
  readonly status: string | null;
  readonly notice: SkillNotice | null;
  readonly conflict: SkillConflict | null;
  readonly busy: string | null;
  readonly unsettled: SkillUnsettled | null;
  /** True after an acknowledged publication until a GET refresh writes the list. */
  readonly listStale: boolean;
  readonly downloadVersion: string | null;
  readonly downloadFailure: SkillDownloadFailure | null;
  readonly reload: () => void;
  readonly selectFile: (file: File) => Promise<void>;
  readonly confirmReplace: () => void;
  readonly cancelReplace: () => void;
  readonly checkSkills: () => Promise<void>;
  readonly startFresh: () => void;
  readonly cancelUpload: (uploadId: string) => void;
  readonly download: (file: SkillFile) => Promise<void>;
  readonly runNotice: (action: SkillNoticeRun) => void;
};

export const LOADING = "Loading skills…";

export const NOTICE_LABELS: Record<Exclude<SkillNoticeAction, null>, string> = {
  check: "Check skills",
  refresh: "Refresh skills",
  upload: "Upload again",
  choose: "Choose file",
};

/**
 * `missing` is deliberately not terminal: it also describes a never-seen id, so
 * the oldest retained intent stays visible until a published or expired receipt.
 */
export const unsettledNotice = (
  intent: SkillUploadIntent | undefined,
  hasFile: boolean,
): SkillNotice | null => {
  if (intent === undefined) return null;
  return {
    title: hasFile ? "Upload could not be confirmed." : "An upload is not confirmed yet.",
    message: hasFile
      ? "Your selected file is kept."
      : `Check skills to see whether ${intent.filename} published.`,
    action: "check",
  };
};
