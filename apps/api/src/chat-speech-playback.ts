/**
 * Frozen read-aloud preference snapshots, keyed by owner and playback id.
 *
 * One manual Play action creates one snapshot; every later chunk of that same
 * playback reuses the same authoritative model and voice, so another tab
 * changing Voice Settings cannot switch voice mid-reply. Only the preference
 * identity is stored - never reply text, future work or provider input. Rows
 * are removed after `SPEECH_PLAYBACK_TTL_MS` of inactivity and refreshed on
 * each reuse, so a paused playback is bounded rather than unbounded.
 */
import type { AgentContext } from "agents";
import { Option, Schema } from "effect";
import { SpeechPreferences } from "./chat-speech-schema.ts";

export const SPEECH_PLAYBACK_TTL_MS = 30 * 60_000;

/** Canonical synchronous preference identity; doubles as the claim fingerprint. */
export const canonicalSpeechPreferences = (preferences: SpeechPreferences): string =>
  JSON.stringify({
    version: preferences.version,
    revision: preferences.revision,
    transcriptionModel: preferences.transcriptionModel,
    speechModel: preferences.speechModel,
    voice: preferences.voice,
  });

const decodeStored = (raw: string): SpeechPreferences | null => {
  try {
    return Option.getOrNull(Schema.decodeUnknownOption(SpeechPreferences)(JSON.parse(raw)));
  } catch {
    return null;
  }
};

export type PlaybackLookup =
  | { readonly status: "miss" }
  | { readonly status: "mismatch" }
  | { readonly status: "hit"; readonly preferences: SpeechPreferences };

type PlaybackRow = { readonly chat_id: string | null; readonly preferences: string };

export class SpeechPlaybackSnapshots {
  private readonly storage: AgentContext["storage"];

  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS speech_playbacks (
      user_id TEXT NOT NULL,
      playback_id TEXT NOT NULL,
      chat_id TEXT,
      preferences TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, playback_id)
    )`);
    storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS speech_playbacks_updated ON speech_playbacks (updated_at)`,
    );
  }

  cleanup(now: number): void {
    this.storage.sql.exec(
      `DELETE FROM speech_playbacks WHERE updated_at < ?`,
      now - SPEECH_PLAYBACK_TTL_MS,
    );
  }

  /** A hit refreshes inactivity so an active playback never expires mid-reply. */
  read(userId: string, playbackId: string, chatId: string | null, now: number): PlaybackLookup {
    const row = this.storage.sql
      .exec<PlaybackRow>(
        `SELECT chat_id, preferences FROM speech_playbacks
         WHERE user_id = ? AND playback_id = ?`,
        userId,
        playbackId,
      )
      .toArray()[0];
    if (row === undefined) return { status: "miss" };
    if ((row.chat_id ?? null) !== chatId) return { status: "mismatch" };
    const preferences = decodeStored(row.preferences);
    if (preferences === null) return { status: "mismatch" };
    this.storage.sql.exec(
      `UPDATE speech_playbacks SET updated_at = ? WHERE user_id = ? AND playback_id = ?`,
      now,
      userId,
      playbackId,
    );
    return { status: "hit", preferences };
  }

  write(
    userId: string,
    playbackId: string,
    chatId: string | null,
    preferences: SpeechPreferences,
    now: number,
  ): void {
    this.storage.sql.exec(
      `INSERT INTO speech_playbacks (user_id, playback_id, chat_id, preferences, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, playback_id) DO UPDATE SET
         chat_id = excluded.chat_id,
         preferences = excluded.preferences,
         updated_at = excluded.updated_at`,
      userId,
      playbackId,
      chatId,
      canonicalSpeechPreferences(preferences),
      now,
    );
  }
}
