/**
 * Durable one-attempt speech admission, as a catalog-store plugin: the claim
 * transaction freezes the authoritative model/voice (and the playback
 * snapshot) before provider work, and an operation id can never trigger a
 * second paid attempt. An expired playback snapshot that was already claimed
 * fails closed instead of re-freezing a different voice.
 */
import type { AgentContext } from "agents";
import { decodeSpeechPreferences, type SpeechPreferences } from "./chat-speech-schema.ts";
import { canonicalSpeechPreferences, SpeechPlaybackSnapshots } from "./chat-speech-playback.ts";

export const SPEECH_CLAIM_KINDS = ["transcription", "synthesis"] as const;
export type SpeechClaimKind = (typeof SPEECH_CLAIM_KINDS)[number];

export const SPEECH_CLAIM_OUTCOMES = ["completed", "failed"] as const;
export type SpeechClaimOutcome = (typeof SPEECH_CLAIM_OUTCOMES)[number];

export type SpeechClaimRequest = {
  readonly userId: string;
  readonly operationId: string;
  readonly kind: SpeechClaimKind;
  readonly chatId: string | null;
  /** Stable for every chunk of one manual read-aloud action; null otherwise. */
  readonly playbackId: string | null;
  /** Canonical input identity computed by the handler; no input text is stored. */
  readonly inputFingerprint: string;
};

export type SpeechClaimFailure = "duplicate" | "conflict" | "busy" | "rate_limited" | "unavailable";

export type SpeechClaimDecision =
  | { readonly ok: true; readonly claimId: string; readonly preferences: SpeechPreferences }
  | { readonly ok: false; readonly code: SpeechClaimFailure };

export const SPEECH_CLAIM_LIMITS = {
  maxInFlightPerUser: 2,
  maxClaimsPerMinute: 6,
  staleAfterMs: 5 * 60_000,
} as const;
export type SpeechClaimLimits = typeof SPEECH_CLAIM_LIMITS;

export type SpeechClaimStoreOptions = {
  /** Synchronous authoritative preference read, called inside the claim transaction. */
  readonly preferences: () => SpeechPreferences;
};

type Selection =
  | { readonly ok: true; readonly preferences: SpeechPreferences }
  | { readonly ok: false; readonly code: SpeechClaimFailure };

export class SpeechClaimStore {
  private readonly storage: AgentContext["storage"];
  private readonly playbacks: SpeechPlaybackSnapshots;
  private readonly preferences: () => SpeechPreferences;

  constructor(storage: AgentContext["storage"], options: SpeechClaimStoreOptions) {
    this.storage = storage;
    this.playbacks = new SpeechPlaybackSnapshots(storage);
    this.preferences = options.preferences;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS speech_claims (
      claim_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation_id TEXT NOT NULL,
      kind TEXT NOT NULL, chat_id TEXT, playback_id TEXT,
      preferences_fingerprint TEXT NOT NULL, input_fingerprint TEXT NOT NULL,
      state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    storage.sql.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS speech_claims_operation
       ON speech_claims (user_id, operation_id)`,
    );
    storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS speech_claims_user_state
       ON speech_claims (user_id, state, updated_at)`,
    );
    storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS speech_claims_playback
       ON speech_claims (user_id, playback_id)`,
    );
  }

  /** Fails closed: an unknown or unreadable catalog is not proof of ownership. */
  ownsChat(chatId: string): boolean {
    try {
      return this.rows(`SELECT COUNT(*) AS total FROM chats WHERE id = ?`, chatId) > 0;
    } catch {
      return false;
    }
  }

  private rows(sql: string, ...params: readonly unknown[]): number {
    const row = this.storage.sql.exec<{ total: number }>(sql, ...params).toArray()[0];
    return row?.total ?? 0;
  }

  /** Expired in-flight claims stop counting against concurrency but stay consumed. */
  private sweep(now: number): void {
    this.storage.sql.exec(
      `UPDATE speech_claims SET state = 'uncertain', updated_at = ?
       WHERE state = 'in_flight' AND updated_at < ?`,
      now,
      now - SPEECH_CLAIM_LIMITS.staleAfterMs,
    );
  }

  /** Resolves and validates the authoritative selection for this operation. */
  private select(request: SpeechClaimRequest, now: number): Selection {
    if (request.kind === "synthesis" && request.playbackId !== null) {
      const lookup = this.playbacks.read(request.userId, request.playbackId, request.chatId, now);
      if (lookup.status === "mismatch") return { ok: false, code: "conflict" };
      if (lookup.status === "hit") return { ok: true, preferences: lookup.preferences };
      const used = this.rows(
        `SELECT COUNT(*) AS total FROM speech_claims WHERE user_id = ? AND playback_id = ?`,
        request.userId,
        request.playbackId,
      );
      if (used > 0) return { ok: false, code: "conflict" };
      const preferences = decodeSpeechPreferences(this.preferences());
      if (preferences === null) return { ok: false, code: "unavailable" };
      this.playbacks.write(request.userId, request.playbackId, request.chatId, preferences, now);
      return { ok: true, preferences };
    }
    const preferences = decodeSpeechPreferences(this.preferences());
    return preferences === null ? { ok: false, code: "unavailable" } : { ok: true, preferences };
  }

  async claim(request: SpeechClaimRequest): Promise<SpeechClaimDecision> {
    const now = Date.now();
    return this.storage.transactionSync(() => {
      this.sweep(now);
      this.playbacks.cleanup(now);
      const existing = this.storage.sql
        .exec<{
          readonly kind: string;
          readonly chat_id: string | null;
          readonly input_fingerprint: string;
        }>(
          `SELECT kind, chat_id, input_fingerprint FROM speech_claims
           WHERE user_id = ? AND operation_id = ?`,
          request.userId,
          request.operationId,
        )
        .toArray()[0];
      if (existing !== undefined) {
        const same =
          existing.kind === request.kind &&
          (existing.chat_id ?? null) === (request.chatId ?? null) &&
          existing.input_fingerprint === request.inputFingerprint;
        return { ok: false as const, code: same ? "duplicate" : "conflict" };
      }
      const inFlight = this.rows(
        `SELECT COUNT(*) AS total FROM speech_claims WHERE user_id = ? AND state = 'in_flight'`,
        request.userId,
      );
      if (inFlight >= SPEECH_CLAIM_LIMITS.maxInFlightPerUser)
        return { ok: false as const, code: "busy" };
      const recent = this.rows(
        `SELECT COUNT(*) AS total FROM speech_claims WHERE user_id = ? AND created_at >= ?`,
        request.userId,
        now - 60_000,
      );
      if (recent >= SPEECH_CLAIM_LIMITS.maxClaimsPerMinute)
        return { ok: false as const, code: "rate_limited" };
      const selection = this.select(request, now);
      if (!selection.ok) return selection;
      const claimId = crypto.randomUUID();
      this.storage.sql.exec(
        `INSERT INTO speech_claims
         (claim_id, user_id, operation_id, kind, chat_id, playback_id, preferences_fingerprint,
          input_fingerprint, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_flight', ?, ?)`,
        claimId,
        request.userId,
        request.operationId,
        request.kind,
        request.chatId,
        request.playbackId,
        canonicalSpeechPreferences(selection.preferences),
        request.inputFingerprint,
        now,
        now,
      );
      return { ok: true as const, claimId, preferences: selection.preferences };
    });
  }

  async settle(claimId: string, outcome: SpeechClaimOutcome): Promise<void> {
    this.storage.sql.exec(
      `UPDATE speech_claims SET state = ?, updated_at = ?
       WHERE claim_id = ? AND state = 'in_flight'`,
      outcome,
      Date.now(),
      claimId,
    );
  }
}
