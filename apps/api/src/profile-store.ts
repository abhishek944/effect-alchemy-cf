/**
 * Owner-catalog storage for the saved profile record.
 *
 * One revisioned record is authoritative for the display name, about me and
 * avatar reference. Object bytes exist (with a durable lifecycle row) before the
 * record can reference them, and the publication transaction activates exactly
 * one ready stage while retiring the previous avatar, so no reader ever sees a
 * reference without bytes and a superseded avatar can never become current again.
 */
import type { AgentContext } from "agents";
import { decodeOption } from "./chat-internal.ts";
import type { ProfileObjects } from "./profile-objects.ts";
import {
  ABOUT_ME_MAX,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  initialProfileRecord,
  normalizeAboutMe,
  normalizeDisplayName,
  ProfileRecord,
  type AvatarRef,
  type ProfileResolution,
  type ProfileWrite,
} from "./profile-model.ts";

type Publication = { readonly record: ProfileRecord };

export class ProfileStore {
  private readonly storage: AgentContext["storage"];
  private readonly objects: ProfileObjects;

  constructor(storage: AgentContext["storage"], objects: ProfileObjects) {
    this.storage = storage;
    this.objects = objects;
    storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS profile (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
  }

  private readRow(): ProfileRecord | null {
    const row = this.storage.sql
      .exec<{ value: string }>(`SELECT value FROM profile WHERE key = 'profile'`)
      .toArray()[0];
    if (row === undefined) return null;
    const raw: unknown = JSON.parse(row.value);
    const parsed = decodeOption(ProfileRecord, raw);
    if (parsed === null) throw new Error("Stored profile is invalid");
    return parsed;
  }

  private putRecord(record: ProfileRecord): void {
    this.storage.sql.exec(
      `INSERT INTO profile (key, value) VALUES ('profile', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(record),
    );
  }

  /**
   * Non-creating read for the chat tool: null until the authenticated browser
   * seed exists, so a tool call can never win first-writer authority with a
   * synthetic fallback name.
   */
  find(): ProfileRecord | null {
    return this.readRow();
  }

  /**
   * Seeds the record once from the authenticated account name. Revision 0 means
   * the first explicit save is still an ordinary revision-guarded write.
   */
  read(seedName: string): ProfileRecord {
    const existing = this.readRow();
    if (existing !== null) return existing;
    return this.storage.transactionSync(() => {
      const current = this.readRow();
      if (current !== null) return current;
      const candidate = normalizeDisplayName(seedName);
      const valid = candidate.length >= DISPLAY_NAME_MIN && candidate.length <= DISPLAY_NAME_MAX;
      const name = valid ? candidate : "User";
      const record: ProfileRecord = { ...initialProfileRecord(), displayName: name };
      this.putRecord(record);
      return record;
    });
  }

  /**
   * One atomic publication of name, about me and the avatar reference.
   * The revision guard refuses stale or replayed writes without changing anything.
   */
  publish(input: ProfileWrite, now: number): ProfileResolution<Publication> {
    const name = normalizeDisplayName(input.displayName);
    if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX)
      return { ok: false, code: "invalid_input" };
    // Explicit length check: a decoded `null` about me is a valid value, so the
    // nullable schema cannot be tested through a null sentinel.
    const aboutMe = normalizeAboutMe(input.aboutMe);
    if (aboutMe !== null && aboutMe.length > ABOUT_ME_MAX)
      return { ok: false, code: "invalid_input" };
    return this.storage.transactionSync(() => {
      const current = this.readRow() ?? initialProfileRecord();
      if (
        current.revision !== input.expectedRevision ||
        current.revision === Number.MAX_SAFE_INTEGER
      )
        return { ok: false, code: "revision_conflict" };
      const resolved = this.resolveAvatar(current, input.avatar, now);
      if (!resolved.ok) return resolved;
      const record: ProfileRecord = {
        version: 1,
        revision: current.revision + 1,
        displayName: name,
        aboutMe,
        avatar: resolved.value.ref,
      };
      this.putRecord(record);
      return { ok: true, value: { record } };
    });
  }

  private resolveAvatar(
    current: ProfileRecord,
    instruction: ProfileWrite["avatar"],
    now: number,
  ): ProfileResolution<{ readonly ref: AvatarRef }> {
    const previous = current.avatar.kind === "photo" ? current.avatar.avatarId : null;
    if (instruction.kind === "keep") return { ok: true, value: { ref: current.avatar } };
    if (instruction.kind === "remove") {
      if (previous !== null) this.objects.retire(previous, now);
      return { ok: true, value: { ref: { kind: "none" } } };
    }
    if (previous === instruction.avatarId) return { ok: true, value: { ref: current.avatar } };
    // Ready-only: a superseded, expired, claimed or swept stage is never publishable.
    const staged = this.objects.pending(instruction.avatarId, now);
    if (staged === null) return { ok: false, code: "avatar_not_staged" };
    this.objects.activate(instruction.avatarId);
    if (previous !== null) this.objects.retire(previous, now);
    return {
      ok: true,
      value: {
        ref: {
          kind: "photo",
          avatarId: staged.avatarId,
          mediaType: staged.mediaType,
          width: staged.width,
          height: staged.height,
          byteSize: staged.byteSize,
          digest: staged.digest,
        },
      },
    };
  }
}
