import { ChatApiError } from "@/lib/chat-api";
import type { ChatSelection } from "@/lib/chat-capability-types";
import { parseChatSelection } from "@/lib/chat-capability-validate";
import { isRecord, isUuid } from "@/lib/chat-validate-base";

/** Complete frozen New Send command; nothing secret or message-derived. */
export type NewSendCommand = {
  readonly operationId: string;
  readonly sourceOperationId: string;
  readonly sourceAttemptId: string;
  readonly selection: ChatSelection;
};

/** Bounded uncertain commands per chat; at the cap new work is refused. */
export const MAX_UNCERTAIN_NEW_SENDS = 8;

/** Persistence outcome: only `saved` may be dispatched for new work. */
export type NewSendSave = "saved" | "full" | "unavailable";

const KEY_PREFIX = "chat-skills-new-send:v1:";
const MAX_VALUE_CHARS = 512;

const storage = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const keyFor = (chatId: string, failedAttemptId: string): string =>
  `${KEY_PREFIX}${chatId}:${failedAttemptId}`;

export const sameSelection = (left: ChatSelection, right: ChatSelection): boolean =>
  left.provider === right.provider && left.model === right.model && left.effort === right.effort;

export type NewSendRead =
  | { readonly kind: "command"; readonly command: NewSendCommand }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable" };

/**
 * Reads the exact command for this rendered target. Unreadable or mismatched
 * retained metadata is never proof of "no command": it returns `unreadable` so
 * the caller refuses new work instead of minting another identity.
 */
export const readNewSendCommand = (
  chatId: string,
  expected: { readonly logicalOperationId: string; readonly failedAttemptId: string },
): NewSendRead => {
  const store = storage();
  if (store === null) return { kind: "none" };
  let raw: string | null = null;
  try {
    raw = store.getItem(keyFor(chatId, expected.failedAttemptId));
  } catch {
    return { kind: "unreadable" };
  }
  if (raw === null) return { kind: "none" };
  if (raw.length > MAX_VALUE_CHARS) return { kind: "unreadable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unreadable" };
  }
  if (!isRecord(parsed)) return { kind: "unreadable" };
  const { operationId, sourceOperationId, sourceAttemptId, selection } = parsed;
  if (!isUuid(operationId) || !isUuid(sourceOperationId) || !isUuid(sourceAttemptId))
    return { kind: "unreadable" };
  if (
    sourceOperationId !== expected.logicalOperationId ||
    sourceAttemptId !== expected.failedAttemptId
  )
    return { kind: "unreadable" };
  const chosen = parseChatSelection(selection);
  if (chosen === null) return { kind: "unreadable" };
  return {
    kind: "command",
    command: { operationId, sourceOperationId, sourceAttemptId, selection: chosen },
  };
};

const countFor = (store: Storage, chatId: string): number => {
  const prefix = `${KEY_PREFIX}${chatId}:`;
  let count = 0;
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (key !== null && key.startsWith(prefix)) count++;
  }
  return count;
};

/**
 * Persists a new exact command, or refuses. Existing entries are never evicted
 * and there is no in-memory-only fallback for new work: `full` at the bounded
 * cap and `unavailable` without session storage both block the POST.
 */
export const writeNewSendCommand = (
  chatId: string,
  failedAttemptId: string,
  command: NewSendCommand,
): NewSendSave => {
  const store = storage();
  if (store === null) return "unavailable";
  try {
    if (store.getItem(keyFor(chatId, failedAttemptId)) === null) {
      if (countFor(store, chatId) >= MAX_UNCERTAIN_NEW_SENDS) return "full";
    }
    store.setItem(keyFor(chatId, failedAttemptId), JSON.stringify(command));
    return "saved";
  } catch {
    return "unavailable";
  }
};

/** Clears only when the stored command is still this exact operation. */
export const clearNewSendCommand = (
  chatId: string,
  failedAttemptId: string,
  operationId: string,
): void => {
  const store = storage();
  if (store === null) return;
  try {
    const raw = store.getItem(keyFor(chatId, failedAttemptId));
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.operationId !== operationId) return;
    store.removeItem(keyFor(chatId, failedAttemptId));
  } catch {
    // Nothing further to clear.
  }
};

/** Deterministic UUID retry key: a remount or reload regenerates the same one. */
export const retryKeyFor = async (
  logicalOperationId: string,
  failedAttemptId: string,
): Promise<string> => {
  const bytes = new TextEncoder().encode(
    `skills-retry:v1|${logicalOperationId}|${failedAttemptId}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** True only for a strict terminal rejection naming this exact command. */
export const isExactNoAdmission = (error: unknown, command: NewSendCommand): boolean =>
  error instanceof ChatApiError &&
  error.rejection !== null &&
  error.rejection.operationId === command.operationId &&
  error.rejection.logicalOperationId === command.operationId;
