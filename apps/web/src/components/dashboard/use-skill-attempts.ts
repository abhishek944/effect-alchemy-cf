/**
 * Retained attempts, explicit conflict decisions and receipt settlement.
 *
 * The queue never overwrites an unresolved id. Every retirement is a
 * compare-and-clear by exact upload id, so a late callback from another mount
 * cannot erase a newer attempt. A `missing` receipt stays uncertain; only a
 * published receipt or a tombstoned-POST rejection is terminal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { clearSkillAttempt, readSkillAttempts, type SkillUploadIntent } from "@/lib/skills-attempt";
import type { SkillFile, SkillUploadReceipt } from "@/lib/skills-types";
import type { SkillCandidate } from "@/lib/skills-file";
import { useSkillAttemptRunner, type SkillAttempter } from "./skills-attempt-runner";
import { useSkillCancelAttempt, type SkillCanceller } from "./skills-cancel-attempt";
import {
  unsettledNotice,
  type HeldUpload,
  type RetryUpload,
  type SkillConflict,
  type SkillListRead,
  type SkillNotice,
  type SkillUnsettled,
} from "./skills-library-model";

export type SkillAttemptsControl = {
  readonly conflict: SkillConflict | null;
  readonly retry: RetryUpload | null;
  readonly unsettledNotice: SkillNotice | null;
  readonly attempt: SkillAttempter;
  readonly cancelAttempt: SkillCanceller;
  readonly unsettled: SkillUnsettled | null;
  readonly settle: (uploadId: string, receipt: SkillUploadReceipt | null) => void;
  readonly openConflict: (file: File, candidate: SkillCandidate, current: SkillFile) => void;
  readonly cancelConflict: () => void;
};

type Channel = {
  readonly userId: string;
  readonly files: readonly SkillFile[];
  readonly read: SkillListRead;
  readonly setBusy: (value: string | null) => void;
  readonly setNotice: (notice: SkillNotice | null) => void;
  readonly setStatus: (value: string | null) => void;
};

export default function useSkillAttempts(channel: Channel): SkillAttemptsControl {
  const { userId, files, read, setBusy, setNotice, setStatus } = channel;
  const [intents, setIntents] = useState<readonly SkillUploadIntent[]>(() =>
    readSkillAttempts(userId),
  );
  const [heldIds, setHeldIds] = useState<readonly string[]>([]);
  const [conflict, setConflict] = useState<SkillConflict | null>(null);
  const [retry, setRetry] = useState<RetryUpload | null>(null);
  const heldRef = useRef(new Map<string, HeldUpload>());
  const aliveRef = useRef(true);

  const retire = useCallback(
    (uploadId: string) => {
      clearSkillAttempt(userId, uploadId);
      heldRef.current.delete(uploadId);
      setHeldIds((current) => current.filter((id) => id !== uploadId));
      setIntents(readSkillAttempts(userId));
    },
    [userId],
  );

  const expire = useCallback(
    (uploadId: string, message: string) => {
      const held = heldRef.current.get(uploadId) ?? null;
      const intent = readSkillAttempts(userId).find((entry) => entry.uploadId === uploadId) ?? null;
      retire(uploadId);
      setStatus(null);
      if (held !== null) {
        setRetry({
          file: held.file,
          candidate: held.candidate,
          replaceVersion: intent?.replaceVersion ?? null,
        });
        setNotice({ title: "That upload can no longer be used.", message, action: "upload" });
        return;
      }
      setNotice({
        title: "That upload expired.",
        message: "Choose the file again to upload it.",
        action: "choose",
      });
    },
    [retire, setNotice, setStatus, userId],
  );

  const settle = useCallback(
    (uploadId: string, receipt: SkillUploadReceipt | null) => {
      if (receipt === null || receipt.uploadId !== uploadId) return;
      // A late GET may resolve after this exact intent was cancelled or retired.
      if (!readSkillAttempts(userId).some((entry) => entry.uploadId === uploadId)) return;
      if (receipt.state === "published") {
        retire(uploadId);
        setStatus("Upload completed.");
        setNotice(null);
        return;
      }
      if (receipt.state === "expired") {
        expire(uploadId, "That upload expired. Upload the file again.");
        return;
      }
      setStatus(null);
      setNotice(null);
    },
    [expire, retire, setNotice, setStatus, userId],
  );

  function hold(uploadId: string, held: HeldUpload) {
    heldRef.current.set(uploadId, held);
    setHeldIds((current) => (current.includes(uploadId) ? current : [...current, uploadId]));
  }

  function takeHeld(uploadId: string) {
    const held = heldRef.current.get(uploadId) ?? null;
    heldRef.current.delete(uploadId);
    return held;
  }
  function markUncertain(uploadId: string) {
    setIntents(readSkillAttempts(userId));
    setHeldIds((current) => (current.includes(uploadId) ? current : [...current, uploadId]));
  }

  function isAlive() {
    return aliveRef.current;
  }

  const attempt = useSkillAttemptRunner({
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
  });

  useEffect(() => {
    aliveRef.current = true;
    const oldest = readSkillAttempts(userId)[0];
    void (async () => {
      const outcome = await read(oldest?.uploadId, "load");
      if (outcome.kind === "receipt" && oldest !== undefined && aliveRef.current) {
        settle(oldest.uploadId, outcome.receipt);
      }
    })();
    return () => {
      aliveRef.current = false;
    };
  }, [aliveRef, read, settle, userId]);
  const cancelAttempt = useSkillCancelAttempt({
    isAlive,
    retire,
    read,
    setBusy,
    setNotice,
    setStatus,
  });

  const oldest = intents[0];

  return {
    conflict,
    retry,
    cancelAttempt,
    unsettled:
      oldest === undefined ? null : { uploadId: oldest.uploadId, filename: oldest.filename },
    unsettledNotice: unsettledNotice(
      oldest,
      oldest !== undefined && heldIds.includes(oldest.uploadId),
    ),
    attempt,
    settle,
    openConflict: (file, candidate, current) => {
      setStatus(null);
      setConflict({ file, candidate, current, stale: false });
    },
    cancelConflict: () => setConflict(null),
  };
}
