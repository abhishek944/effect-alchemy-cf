/**
 * Synchronous admission fence and user operations for Skills uploads.
 *
 * A ref lock is taken before file reading, publication, replacement or a check,
 * so two picker callbacks or a Replace double click cannot run together. Every
 * release is in the same operation's finally; no outcome is inferred from state.
 */
import { useRef } from "react";
import { readSkillAttempts } from "@/lib/skills-attempt";
import { readSkillCandidate } from "@/lib/skills-file";
import type { SkillFile, SkillUploadReceipt } from "@/lib/skills-types";
import { skillFilenameKey } from "@/lib/skills-validate";
import useSkillAttempts from "./use-skill-attempts";
import type {
  RetryUpload,
  SkillConflict,
  SkillListRead,
  SkillNotice,
  SkillUnsettled,
} from "./skills-library-model";

export type SkillUploadControl = {
  readonly conflict: SkillConflict | null;
  readonly unsettled: SkillUnsettled | null;
  readonly unsettledNotice: SkillNotice | null;
  readonly settle: (uploadId: string, receipt: SkillUploadReceipt | null) => void;
  readonly selectFile: (file: File) => Promise<void>;
  readonly confirmReplace: () => void;
  readonly cancelReplace: () => void;
  readonly checkSkills: () => Promise<void>;
  readonly startFresh: () => void;
  readonly cancelUpload: (uploadId: string) => void;
};

type Channel = {
  readonly userId: string;
  readonly files: readonly SkillFile[];
  readonly read: SkillListRead;
  readonly setBusy: (value: string | null) => void;
  readonly setNotice: (notice: SkillNotice | null) => void;
  readonly setStatus: (value: string | null) => void;
};

export default function useSkillUploads(channel: Channel): SkillUploadControl {
  const { userId, files, read, setBusy, setNotice, setStatus } = channel;
  const attempts = useSkillAttempts(channel);
  const lockRef = useRef<string | null>(null);

  function begin(key: string): boolean {
    if (lockRef.current !== null) return false;
    lockRef.current = key;
    return true;
  }

  function end() {
    lockRef.current = null;
    setBusy(null);
  }

  async function selectFile(file: File) {
    if (!begin("select")) return;
    setBusy("select");
    setNotice(null);
    try {
      const result = await readSkillCandidate(file);
      if (!result.ok) {
        setStatus(null);
        setNotice({ title: "Upload a .txt or .md file.", message: result.message, action: null });
        return;
      }
      const candidate = result.candidate;
      const key = skillFilenameKey(candidate.filename);
      const existing = files.find((entry) => skillFilenameKey(entry.filename) === key);
      if (existing !== undefined) {
        attempts.openConflict(file, candidate, existing);
        return;
      }
      await attempts.attempt(file, candidate, null);
    } finally {
      end();
    }
  }

  function confirmReplace() {
    const current = attempts.conflict;
    if (current === null || !begin("replace")) return;
    void attempts.attempt(current.file, current.candidate, current.current.version).finally(end);
  }

  function startFresh() {
    const current: RetryUpload | null = attempts.retry;
    if (current === null || !begin("fresh")) return;
    void attempts.attempt(current.file, current.candidate, current.replaceVersion).finally(end);
  }

  function cancelUpload(uploadId: string) {
    if (!begin("cancel")) return;
    void attempts.cancelAttempt(uploadId).finally(end);
  }

  async function checkSkills() {
    if (!begin("check")) return;
    setBusy("check");
    setNotice(null);
    try {
      for (const intent of readSkillAttempts(userId)) {
        const outcome = await read(intent.uploadId, "check");
        if (outcome.kind !== "receipt") break;
        attempts.settle(intent.uploadId, outcome.receipt);
      }
    } finally {
      end();
    }
  }

  return {
    conflict: attempts.conflict,
    unsettled: attempts.unsettled,
    unsettledNotice: attempts.unsettledNotice,
    settle: attempts.settle,
    selectFile,
    confirmReplace,
    cancelReplace: attempts.cancelConflict,
    checkSkills,
    startFresh,
    cancelUpload,
  };
}
