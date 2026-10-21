import { request, unexpectedResponse } from "@/lib/chat-api";
import { isRecord, isText } from "@/lib/chat-validate-base";

/** Side-effect-free owner readiness; never installs or mutates a pin. */
export type SkillReadiness = {
  ready: boolean;
  message: string;
  revision: string | null;
  files: number;
};

export async function getSkillReadiness(id: string): Promise<SkillReadiness> {
  const raw = await request(`/api/chats/${encodeURIComponent(id)}/skills/readiness`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!isRecord(raw) || typeof raw.ready !== "boolean" || !isText(raw.message))
    throw unexpectedResponse();
  if (raw.revision !== null && !isText(raw.revision)) throw unexpectedResponse();
  if (typeof raw.files !== "number" || !Number.isSafeInteger(raw.files)) throw unexpectedResponse();
  return { ready: raw.ready, message: raw.message, revision: raw.revision, files: raw.files };
}
