import { requestDecoded } from "@/lib/chat-api";
import { isRecord, isText } from "@/lib/chat-validate-base";

/** Side-effect-free owner readiness; never installs or mutates a pin. */
export type SkillReadiness = {
  ready: boolean;
  message: string;
  revision: string | null;
  files: number;
};

export async function getSkillReadiness(id: string): Promise<SkillReadiness> {
  return requestDecoded(
    `/api/chats/${encodeURIComponent(id)}/skills/readiness`,
    "chat.skill-readiness",
    (raw) => {
      if (!isRecord(raw) || typeof raw.ready !== "boolean" || !isText(raw.message)) return null;
      if (raw.revision !== null && !isText(raw.revision)) return null;
      if (typeof raw.files !== "number" || !Number.isSafeInteger(raw.files)) return null;
      return { ready: raw.ready, message: raw.message, revision: raw.revision, files: raw.files };
    },
    { signal: AbortSignal.timeout(15_000) },
  );
}
