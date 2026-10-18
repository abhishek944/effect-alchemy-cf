/** Owner avatar lifecycle: reserve before I/O, claim before delete, ready-only publish. */
import type { AgentContext } from "agents";
import { decodeOption } from "./chat-internal.ts";
import { StagedAvatar, type ProfileResolution } from "./profile-model.ts";

type ObjectRow = {
  avatar_id: string;
  state: string;
  media_type: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  digest: string | null;
  created_at: number;
};

export const OBJECT_STATES = ["reserved", "ready", "active", "deleting"] as const;
export const READY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RESERVED_MAX_AGE_MS = 15 * 60 * 1000;

const fromRow = (row: ObjectRow): StagedAvatar | null =>
  decodeOption(StagedAvatar, {
    avatarId: row.avatar_id,
    mediaType: row.media_type,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    digest: row.digest,
    stagedAt: row.created_at,
  });

export class ProfileObjects {
  private readonly storage: AgentContext["storage"];

  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS profile_objects (
      avatar_id TEXT PRIMARY KEY, state TEXT NOT NULL, media_type TEXT, width INTEGER,
      height INTEGER, byte_size INTEGER, digest TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }

  private row(avatarId: string): ObjectRow | null {
    return (
      this.storage.sql
        .exec<ObjectRow>(`SELECT * FROM profile_objects WHERE avatar_id = ?`, avatarId)
        .toArray()[0] ?? null
    );
  }

  /** Any tracked lifecycle state protects a key from orphan reconciliation. */
  has(avatarId: string): boolean {
    return this.row(avatarId) !== null;
  }

  /** Durable reservation created before the object write; retried by the sweep if abandoned. */
  reserve(avatarId: string, now: number): ProfileResolution<{ readonly reserved: true }> {
    return this.storage.transactionSync(() => {
      const existing = this.row(avatarId);
      if (existing !== null) {
        if (existing.state !== "reserved") return { ok: false, code: "avatar_not_staged" };
        return { ok: true, value: { reserved: true } };
      }
      this.storage.sql.exec(
        `INSERT INTO profile_objects (avatar_id, state, created_at, updated_at)
         VALUES (?, 'reserved', ?, ?)`,
        avatarId,
        now,
        now,
      );
      return { ok: true, value: { reserved: true } };
    });
  }

  /** Marks a reservation ready with validated metadata; anything else is refused. */
  markReady(input: {
    avatarId: string;
    mediaType: string;
    width: number;
    height: number;
    byteSize: number;
    digest: string;
    now: number;
  }): ProfileResolution<StagedAvatar> {
    return this.storage.transactionSync(() => {
      const existing = this.row(input.avatarId);
      if (existing === null || existing.state !== "reserved")
        return { ok: false, code: "avatar_not_staged" };
      this.storage.sql.exec(
        `UPDATE profile_objects SET state = 'ready', media_type = ?, width = ?, height = ?,
         byte_size = ?, digest = ?, updated_at = ? WHERE avatar_id = ? AND state = 'reserved'`,
        input.mediaType,
        input.width,
        input.height,
        input.byteSize,
        input.digest,
        input.now,
        input.avatarId,
      );
      const row = this.row(input.avatarId);
      const avatar = row === null ? null : fromRow(row);
      if (avatar === null) return { ok: false, code: "unavailable" };
      return { ok: true, value: avatar };
    });
  }

  /** Publishable stage lookup: `ready` only, so superseded or claimed rows never match. */
  pending(avatarId: string, now: number): StagedAvatar | null {
    const row = this.row(avatarId);
    return row === null || row.state !== "ready" || row.created_at <= now - READY_MAX_AGE_MS
      ? null
      : fromRow(row);
  }

  /** Activation inside the caller's publication transaction. */
  activate(avatarId: string): void {
    this.storage.sql.exec(
      `UPDATE profile_objects SET state = 'active', updated_at = ? WHERE avatar_id = ? AND state = 'ready'`,
      Date.now(),
      avatarId,
    );
  }

  /** Superseded published avatar: unpublishable and queued for deletion in the same transaction. */
  retire(avatarId: string, now: number): void {
    this.storage.sql.exec(
      `UPDATE profile_objects SET state = 'deleting', updated_at = ?
       WHERE avatar_id = ? AND state IN ('active', 'ready', 'reserved')`,
      now,
      avatarId,
    );
  }

  /** Cancel a not-yet-published stage, or acknowledge one already queued for deletion. */
  cancel(avatarId: string, now: number): boolean {
    return this.storage.transactionSync(() => {
      const row = this.row(avatarId);
      if (row === null) return false;
      if (row.state === "active") return false;
      this.retire(avatarId, now);
      return true;
    });
  }

  /**
   * Atomically claims every cleanup candidate into `deleting` and returns the keys
   * to delete: ready stages past their lifetime, reservations whose put never
   * completed, and rows already waiting on a retried delete.
   */
  claimCleanup(
    now: number,
    readyMaxAgeMs: number,
    reservedMaxAgeMs: number,
    limit = 50,
  ): readonly string[] {
    return this.storage.transactionSync(() => {
      const stale = this.storage.sql
        .exec<{ avatar_id: string }>(
          `SELECT avatar_id FROM profile_objects
           WHERE (state = 'ready' AND created_at <= ?)
              OR (state = 'reserved' AND created_at <= ?)
              OR state = 'deleting'
           ORDER BY created_at LIMIT ?`,
          now - readyMaxAgeMs,
          now - reservedMaxAgeMs,
          limit,
        )
        .toArray()
        .map((row) => row.avatar_id);
      for (const avatarId of stale) this.retire(avatarId, now);
      return stale;
    });
  }

  /** Rows awaiting deletion without a fresh claim, used when a delete must be retried. */
  deleting(limit = 50): readonly string[] {
    return this.storage.sql
      .exec<{ avatar_id: string }>(
        `SELECT avatar_id FROM profile_objects WHERE state = 'deleting'
         ORDER BY updated_at LIMIT ?`,
        limit,
      )
      .toArray()
      .map((row) => row.avatar_id);
  }

  /** Confirms deletion; a failed delete stays claimed and is retried by the next sweep. */
  confirmDeleted(avatarIds: readonly string[]): void {
    for (const avatarId of avatarIds) {
      this.storage.sql.exec(
        `DELETE FROM profile_objects WHERE avatar_id = ? AND state = 'deleting'`,
        avatarId,
      );
    }
  }
}
