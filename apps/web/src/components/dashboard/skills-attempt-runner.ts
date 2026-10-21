/**
 * One dispatched upload attempt and how its outcome changes the queue.
 *
 * Late outcomes from an unmounted panel are dropped before they can touch
 * state or storage. Every terminal path retires only its own upload id.
 */
import {
  createSkillIntent,
  readSkillAttempts,
  saveSkillAttempt,
  SKILL_STORAGE_MESSAGE,
  type SkillUploadIntent,
} from "@/lib/skills-attempt";
import type { SkillCandidate } from "@/lib/skills-file";
import { publishSkill, type SkillPublicationOutcome } from "@/lib/skills-publish";
import type { SkillFile } from "@/lib/skills-types";
import { skillFilenameKey } from "@/lib/skills-validate";
import {
  type HeldUpload,
  type RetryUpload,
  type SkillConflict,
  type SkillListRead,
  type SkillNotice,
} from "./skills-library-model";

type Channel = {
  readonly userId: string;
  readonly files: readonly SkillFile[];
  readonly read: SkillListRead;
  readonly hold: (uploadId: string, held: HeldUpload) => void;
  readonly takeHeld: (uploadId: string) => HeldUpload | null;
  readonly markUncertain: (uploadId: string) => void;
  readonly isAlive: () => boolean;
  readonly retire: (uploadId: string) => void;
  readonly expire: (uploadId: string, message: string) => void;
  readonly setBusy: (value: string | null) => void;
  readonly setConflict: (conflict: SkillConflict | null) => void;
  readonly setNotice: (notice: SkillNotice | null) => void;
  readonly setRetry: (retry: RetryUpload | null) => void;
  readonly setStatus: (value: string | null) => void;
};

export type SkillAttempter = (
  file: File,
  candidate: SkillCandidate,
  replaceVersion: string | null,
) => Promise<void>;

export type SkillPublishRefreshChannel = {
  readonly read: SkillListRead;
  readonly isAlive: () => boolean;
  readonly setNotice: (notice: SkillNotice | null) => void;
};

/**
 * One refresh through the list owner's epoch after a known-published receipt.
 * A superseded refresh writes nothing; only a failed one announces itself, so
 * an acknowledged upload is never reported as uncertain.
 */
export async function refreshSkillsAfterPublish(
  channel: SkillPublishRefreshChannel,
): Promise<void> {
  const outcome = await channel.read(undefined, "refresh");
  if (outcome.kind !== "failed" || !channel.isAlive()) return;
  channel.setNotice({
    title: "Uploaded, but the list could not refresh.",
    message: "The file is saved. Refresh skills to see the latest list.",
    action: "refresh",
  });
}

export function useSkillAttemptRunner(channel: Channel): SkillAttempter {
  const {
    userId,
    files,
    read,
    hold,
    takeHeld,
    markUncertain,
    isAlive,
    retire,
    expire,
    setBusy,
    setConflict,
    setNotice,
    setRetry,
    setStatus,
  } = channel;

  function apply(
    intent: SkillUploadIntent,
    candidate: SkillCandidate,
    outcome: SkillPublicationOutcome,
  ) {
    if (outcome.kind === "published") {
      retire(intent.uploadId);
      setStatus("Upload completed.");
      setNotice(null);
      void refreshSkillsAfterPublish({ read, isAlive, setNotice });
      return;
    }
    if (outcome.kind === "conflict") {
      const held = takeHeld(intent.uploadId);
      retire(intent.uploadId);
      setStatus(null);
      void read(undefined, "quiet");
      const current =
        outcome.current ??
        files.find(
          (entry) => skillFilenameKey(entry.filename) === skillFilenameKey(candidate.filename),
        ) ??
        null;
      if (held === null || current === null) {
        setNotice({
          title: "That skill changed elsewhere.",
          message: outcome.message,
          action: "refresh",
        });
        return;
      }
      setConflict({ file: held.file, candidate: held.candidate, current, stale: outcome.stale });
      return;
    }
    if (outcome.kind === "expired") {
      expire(intent.uploadId, outcome.message);
      return;
    }
    if (outcome.kind === "uncertain") {
      setStatus(null);
      markUncertain(intent.uploadId);
      return;
    }
    retire(intent.uploadId);
    setStatus(null);
    setNotice({ title: "Upload failed.", message: outcome.message, action: null });
  }

  return async (file, candidate, replaceVersion) => {
    setBusy("upload");
    setNotice(null);
    setStatus(`Uploading ${candidate.filename}…`);
    const existing =
      readSkillAttempts(userId).find(
        (entry) =>
          entry.filename === candidate.filename &&
          entry.digest === candidate.digest &&
          entry.replaceVersion === replaceVersion,
      ) ?? null;
    const intent = existing ?? createSkillIntent(candidate, replaceVersion);
    if (existing === null) {
      const saved = saveSkillAttempt(userId, intent);
      if (saved !== "saved") {
        setStatus(null);
        setNotice(
          saved === "full"
            ? {
                title: "Uploads need attention.",
                message: "Check the earlier uploads before adding another.",
                action: "check",
              }
            : {
                title: "Upload is unavailable.",
                message: SKILL_STORAGE_MESSAGE,
                action: null,
              },
        );
        return;
      }
    }
    setConflict(null);
    setRetry(null);
    hold(intent.uploadId, { file, candidate });
    let outcome: SkillPublicationOutcome;
    try {
      outcome = await publishSkill({
        file,
        filename: candidate.filename,
        uploadId: intent.uploadId,
        replaceVersion,
      });
    } catch {
      if (isAlive()) {
        setStatus(null);
        markUncertain(intent.uploadId);
      }
      return;
    }
    if (!isAlive()) return;
    apply(intent, candidate, outcome);
  };
}
