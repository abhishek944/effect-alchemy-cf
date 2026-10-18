/**
 * Manual validators for the account-profile and account-theme routes.
 *
 * Nothing here trusts a response shape: an unexpected field rejects instead of
 * being partially accepted, and the browser never invents a theme id or an
 * avatar reference the server did not send.
 */
export const ACCOUNT_THEMES = ["light", "dark", "midnight-black", "dusk", "paper"] as const;
export type AccountTheme = (typeof ACCOUNT_THEMES)[number];

export type AvatarView =
  | { kind: "none" }
  | {
      kind: "photo";
      avatarId: string;
      mediaType: string;
      width: number;
      height: number;
      byteSize: number;
      digest: string;
    };

export type ProfileView = {
  displayName: string;
  aboutMe: string | null;
  revision: number;
  avatar: AvatarView;
};

export type AvatarUploadView = {
  avatarId: string;
  mediaType: string;
  width: number;
  height: number;
  byteSize: number;
  digest: string;
};

export type AccountThemeView = {
  theme: AccountTheme;
  revision: number;
  source: "default" | "account";
  canUndo: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads one field from an unknown response envelope without an unsafe assertion. */
export const envelopeField = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const isText = (value: unknown): value is string => typeof value === "string";

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const parseThemeId = (value: unknown): AccountTheme | null =>
  ACCOUNT_THEMES.find((theme) => theme === value) ?? null;

const parseAvatar = (value: unknown): AvatarView | null => {
  if (!isRecord(value)) return null;
  if (value.kind === "none") return { kind: "none" };
  if (value.kind !== "photo") return null;
  if (
    !isText(value.avatarId) ||
    !isText(value.mediaType) ||
    !isText(value.digest) ||
    !isCount(value.width) ||
    !isCount(value.height) ||
    !isCount(value.byteSize)
  )
    return null;
  return {
    kind: "photo",
    avatarId: value.avatarId,
    mediaType: value.mediaType,
    width: value.width,
    height: value.height,
    byteSize: value.byteSize,
    digest: value.digest,
  };
};

export const parseProfileView = (value: unknown): ProfileView | null => {
  if (!isRecord(value)) return null;
  const aboutMe = value.aboutMe;
  if (aboutMe !== null && !isText(aboutMe)) return null;
  const avatar = parseAvatar(value.avatar);
  if (!isText(value.displayName) || !isCount(value.revision) || avatar === null) return null;
  return {
    displayName: value.displayName,
    aboutMe,
    revision: value.revision,
    avatar,
  };
};

export const parseAvatarUpload = (value: unknown): AvatarUploadView | null => {
  if (!isRecord(value)) return null;
  const avatar = parseAvatar({ ...value, kind: "photo" });
  if (avatar === null || avatar.kind !== "photo") return null;
  return {
    avatarId: avatar.avatarId,
    mediaType: avatar.mediaType,
    width: avatar.width,
    height: avatar.height,
    byteSize: avatar.byteSize,
    digest: avatar.digest,
  };
};

export const parseAccountThemeView = (value: unknown): AccountThemeView | null => {
  if (!isRecord(value)) return null;
  const theme = parseThemeId(value.theme);
  if (
    theme === null ||
    !isCount(value.revision) ||
    (value.source !== "default" && value.source !== "account") ||
    typeof value.canUndo !== "boolean"
  )
    return null;
  return { theme, revision: value.revision, source: value.source, canUndo: value.canUndo };
};

/** Formats the derived About me counter; never a hard-coded fixture value. */
export const aboutCount = (value: string): string => `${value.length} / 500`;
