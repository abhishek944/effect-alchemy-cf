/**
 * Explicit cancellation of one frozen retained intent.
 *
 * The upload id comes from the rendered recovery notice, never from "the
 * oldest now", and the endpoint answers only published or expired. Published
 * means the upload already completed: acknowledge it, never delete or roll it
 * back. Transport, parse, identity or non-terminal failures stay uncertain and
 * keep the exact intent tracked for read-only Check skills.
 */
import { cancelSkillUpload } from "@/lib/skills-api";
import type { SkillUploadReceipt } from "@/lib/skills-types";
import { refreshSkillsAfterPublish } from "./skills-attempt-runner";
import type { SkillListRead, SkillNotice } from "./skills-library-model";

type Channel = {
  readonly isAlive: () => boolean;
  readonly retire: (uploadId: string) => void;
  readonly read: SkillListRead;
  readonly setBusy: (value: string | null) => void;
  readonly setNotice: (notice: SkillNotice | null) => void;
  readonly setStatus: (value: string | null) => void;
};

export type SkillCanceller = (uploadId: string) => Promise<void>;

export function useSkillCancelAttempt(channel: Channel): SkillCanceller {
  const { isAlive, retire, read, setBusy, setNotice, setStatus } = channel;

  function stayUncertain() {
    setStatus(null);
    setNotice({
      title: "Could not cancel that upload.",
      message: "It is still tracked. Check skills to see its state.",
      action: "check",
    });
  }

  return async (uploadId) => {
    setBusy("cancel");
    setNotice(null);
    setStatus("Cancelling upload…");
    let receipt: SkillUploadReceipt;
    try {
      receipt = await cancelSkillUpload(uploadId);
    } catch {
      if (isAlive()) stayUncertain();
      return;
    }
    if (!isAlive()) return;
    if (receipt.uploadId !== uploadId) {
      stayUncertain();
      return;
    }
    if (receipt.state === "published") {
      retire(uploadId);
      setStatus("That upload had already completed.");
      setNotice(null);
      void refreshSkillsAfterPublish({ read, isAlive, setNotice });
      return;
    }
    if (receipt.state === "expired") {
      retire(uploadId);
      setStatus("Upload cancelled.");
      setNotice(null);
      return;
    }
    stayUncertain();
  };
}
