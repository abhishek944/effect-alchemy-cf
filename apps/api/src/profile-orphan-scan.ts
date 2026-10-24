/**
 * The owner-prefix obligation outlives individual reservations. A put finishing
 * after an expiry/delete is rediscovered here, even if its Worker never hands off.
 * One bounded page per recurring cleanup; only absent-row, noncurrent IDs delete.
 */
import type * as cf from "@cloudflare/workers-types";
import type { AgentContext } from "agents";
import { Schema } from "effect";
import { withCause, withDiagnostic } from "@starter/diagnostics";
import { DomainUuid } from "./chat-capabilities.ts";
import { decodeOption } from "./chat-internal.ts";
import { avatarObjectPrefix, deleteAvatarKeys } from "./profile-avatar.ts";
import type { ProfileObjects } from "./profile-objects.ts";
import type { ProfileStore } from "./profile-store.ts";

const CURSOR = "profile:orphan-scan:cursor:v1";
type Scope = {
  readonly storage: AgentContext["storage"];
  readonly objects: ProfileObjects;
  readonly profile: ProfileStore;
  readonly bucket: cf.R2Bucket | undefined;
  readonly scope: string;
};

export const reconcileAvatarOrphans = async (scope: Scope): Promise<void> => {
  const { storage, objects, profile, bucket } = scope;
  if (bucket === undefined) return;
  const prefix = avatarObjectPrefix(scope.scope);
  const raw: unknown = await storage.get(CURSOR);
  const cursor = decodeOption(Schema.String, raw);
  let page: cf.R2Objects;
  try {
    page = await bucket.list({ prefix, limit: 50, ...(cursor === null ? {} : { cursor }) });
  } catch (cause) {
    // A stale provider cursor must not permanently disable discovery.
    try {
      await storage.delete(CURSOR);
    } catch (cleanup) {
      throw withDiagnostic(
        withCause(
          new Error("Avatar discovery and cursor cleanup failed"),
          new AggregateError([cause, cleanup]),
        ),
        "profile_orphan_scan_failed",
      );
    }
    throw cause;
  }
  const saved = profile.find()?.avatar;
  const keys: string[] = [];
  for (const object of page.objects) {
    if (!object.key.startsWith(prefix)) continue;
    const id = decodeOption(DomainUuid, object.key.slice(prefix.length));
    if (id === null || objects.has(id)) continue;
    if (saved?.kind === "photo" && saved.avatarId === id) continue;
    // No await between lifecycle/reference checks and building the delete set.
    // A rowless key cannot be activated; server-minted UUIDs are never reused.
    keys.push(object.key);
  }
  await deleteAvatarKeys(bucket, keys);
  if (page.truncated) await storage.put(CURSOR, page.cursor);
  else await storage.delete(CURSOR);
};
