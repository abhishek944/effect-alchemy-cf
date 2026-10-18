/**
 * Account-profile schemas and limits.
 *
 * The saved profile is one revisioned record: display name, optional about me
 * and one avatar reference. Email, roles, provider ids and internal metadata
 * are deliberately absent from every shape here, so they cannot reach the
 * browser view or the `get_user_details` tool result.
 */
import { Schema } from "effect";
import { DomainUuid } from "./chat-capabilities.ts";

export const PROFILE_VERSION = 1;
export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 80;
export const ABOUT_ME_MAX = 500;
/** Private originals: 5 MiB and 2 MP in every format; chat limits are independent. */
export const AVATAR_MAX_BYTES = 5_242_880;
export const AVATAR_MAX_PIXELS = 2_000_000;
/** Additional native RGBA + JS copy budget; not a universal runtime memory guarantee. */
export const WEBP_MAX_DECODED_BYTES = 32 * 1024 * 1024;
export const AVATAR_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const AvatarMediaType = Schema.Literals(AVATAR_MEDIA_TYPES);
export type AvatarMediaType = typeof AvatarMediaType.Type;

export const ProfileRevision = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
);
export type ProfileRevision = typeof ProfileRevision.Type;

/** Non-empty trimmed display name; the same rule runs in the handler and store. */
export const DisplayName = Schema.String.check(
  Schema.makeFilter((value) => {
    const trimmed = value.trim();
    return trimmed.length >= DISPLAY_NAME_MIN && trimmed.length <= DISPLAY_NAME_MAX;
  }),
);
export type DisplayName = typeof DisplayName.Type;

export const AboutMe = Schema.NullOr(Schema.String.check(Schema.isMaxLength(ABOUT_ME_MAX)));
export type AboutMe = typeof AboutMe.Type;

export const AvatarRef = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("photo"),
    avatarId: DomainUuid,
    mediaType: AvatarMediaType,
    width: Schema.Number.check(
      Schema.makeFilter((value) => value > 0 && Number.isSafeInteger(value)),
    ),
    height: Schema.Number.check(
      Schema.makeFilter((value) => value > 0 && Number.isSafeInteger(value)),
    ),
    byteSize: Schema.Number.check(
      Schema.makeFilter((value) => value > 0 && value <= AVATAR_MAX_BYTES),
    ),
    digest: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  }),
]);
export type AvatarRef = typeof AvatarRef.Type;

/** Exact saved record; only `revision` changes across a publication. */
export const ProfileRecord = Schema.Struct({
  version: Schema.Literal(PROFILE_VERSION),
  revision: ProfileRevision,
  displayName: DisplayName,
  aboutMe: AboutMe,
  avatar: AvatarRef,
});
export type ProfileRecord = typeof ProfileRecord.Type;

/** Browser view: identical fields; kept separate so the wire contract can evolve alone. */
export const ProfileView = Schema.Struct({
  displayName: DisplayName,
  aboutMe: AboutMe,
  revision: ProfileRevision,
  avatar: AvatarRef,
});
export type ProfileView = typeof ProfileView.Type;

export const ProfileResponse = Schema.Struct({ profile: ProfileView });
export type ProfileResponse = typeof ProfileResponse.Type;

/** Non-creating read used by the chat tool: null until an authoritative seed exists. */
export const ExistingProfileResponse = Schema.Struct({ profile: Schema.NullOr(ProfileView) });
export type ExistingProfileResponse = typeof ExistingProfileResponse.Type;

export const AvatarInstruction = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("keep") }),
  Schema.Struct({ kind: Schema.Literal("remove") }),
  Schema.Struct({ kind: Schema.Literal("publish"), avatarId: DomainUuid }),
]);
export type AvatarInstruction = typeof AvatarInstruction.Type;

export const ProfileWrite = Schema.Struct({
  expectedRevision: ProfileRevision,
  displayName: DisplayName,
  aboutMe: AboutMe,
  avatar: AvatarInstruction,
});
export type ProfileWrite = typeof ProfileWrite.Type;

export const AvatarUpload = Schema.Struct({
  avatarId: DomainUuid,
  mediaType: AvatarMediaType,
  width: Schema.Number.check(
    Schema.makeFilter((value) => value > 0 && Number.isSafeInteger(value)),
  ),
  height: Schema.Number.check(
    Schema.makeFilter((value) => value > 0 && Number.isSafeInteger(value)),
  ),
  byteSize: Schema.Number.check(
    Schema.makeFilter((value) => value > 0 && value <= AVATAR_MAX_BYTES),
  ),
  digest: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
});
export type AvatarUpload = typeof AvatarUpload.Type;

export const StagedAvatar = Schema.Struct({
  ...AvatarUpload.fields,
  stagedAt: Schema.Number,
});
export type StagedAvatar = typeof StagedAvatar.Type;

/** Reservation body: only the server-minted avatar id crosses the internal boundary. */
export const AvatarIdBody = Schema.Struct({ avatarId: DomainUuid });
export type AvatarIdBody = typeof AvatarIdBody.Type;

/** Internal avatar envelopes: the same `{ avatar }` shape for refs and staged uploads. */
export const AvatarRefResponse = Schema.Struct({ avatar: AvatarRef });
export type AvatarRefResponse = typeof AvatarRefResponse.Type;

export const AvatarUploadResponse = Schema.Struct({ avatar: AvatarUpload });
export type AvatarUploadResponse = typeof AvatarUploadResponse.Type;

export const PROFILE_FAILURES = [
  "invalid_input",
  "invalid_content",
  "unsupported_type",
  "file_too_large",
  "revision_conflict",
  "avatar_not_staged",
  "avatar_missing",
  "unavailable",
] as const;
export const ProfileFailure = Schema.Literals(PROFILE_FAILURES);
export type ProfileFailure = typeof ProfileFailure.Type;

export type ProfileResolution<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ProfileFailure };

const trimmed = (value: string): string => value.trim();

/** Empty or whitespace-only about me is stored as null; over-long text is rejected, not cut. */
export const normalizeAboutMe = (value: string | null): AboutMe => {
  const next = value === null ? "" : trimmed(value);
  return next.length === 0 ? null : next;
};

export const initialProfileRecord = (): ProfileRecord => ({
  version: PROFILE_VERSION,
  revision: 0,
  displayName: "User",
  aboutMe: null,
  avatar: { kind: "none" },
});

export const profileView = (record: ProfileRecord): ProfileView => ({
  displayName: record.displayName,
  aboutMe: record.aboutMe,
  revision: record.revision,
  avatar: record.avatar,
});

/** Exact tool payload: saved values only, empty about me as null. */
export const userDetails = (profile: {
  readonly displayName: string;
  readonly aboutMe: string | null;
}): { displayName: string; aboutMe: string | null } => ({
  displayName: profile.displayName,
  aboutMe: profile.aboutMe,
});

export const normalizeDisplayName = (value: string): string => trimmed(value);
