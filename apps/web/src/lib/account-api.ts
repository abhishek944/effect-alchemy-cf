/**
 * Same-origin client for the authenticated profile and account-theme routes.
 *
 * Every response is validated before use. Avatar bytes travel through the
 * dedicated photo route; the browser never sees an object key, and the only
 * avatar URL is the owner-authenticated photo endpoint itself.
 */
import { errorMessage, requestJson, requestDecoded } from "@/lib/chat-api";
import {
  envelopeField,
  parseAccountThemeView,
  parseAvatarUpload,
  parseProfileView,
  type AccountTheme,
  type AccountThemeView,
  type AvatarUploadView,
  type ProfileView,
} from "@/lib/account-validate";

export const PROFILE_PHOTO_URL = "/api/profile/photo";

export type ProfileWriteInput = {
  expectedRevision: number;
  displayName: string;
  aboutMe: string | null;
  avatar: { kind: "keep" } | { kind: "remove" } | { kind: "publish"; avatarId: string };
};

export async function getProfile(signal?: AbortSignal): Promise<ProfileView> {
  return requestDecoded(
    "/api/profile",
    "account.profile",
    (body) => parseProfileView(envelopeField(body, "profile")),
    signal ? { signal } : undefined,
  );
}

export async function writeProfile(input: ProfileWriteInput): Promise<ProfileView> {
  return requestDecoded(
    "/api/profile",
    "account.profile-write",
    (body) => parseProfileView(envelopeField(body, "profile")),
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

/**
 * Uploads raw bytes with the original filename. The server owns format,
 * completeness, size and pixel validation; the browser declares nothing.
 */
export async function uploadAvatar(file: File, name: string): Promise<AvatarUploadView> {
  return requestDecoded(
    PROFILE_PHOTO_URL,
    "account.avatar-upload",
    (body) => parseAvatarUpload(envelopeField(body, "avatar")),
    {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(name),
      },
      body: file,
    },
  );
}

/** Cancels a staged upload. A missing stage is already gone, so it is not an error. */
export async function cancelAvatar(avatarId: string): Promise<void> {
  try {
    await requestJson(
      `${PROFILE_PHOTO_URL}?id=${encodeURIComponent(avatarId)}`,
      "account.avatar-cancel",
      { method: "DELETE" },
    );
  } catch {
    // The object is unreferenced either way; the catalog sweep owns retrying.
  }
}

export function profilePhotoUrl(avatarId: string): string {
  return `${PROFILE_PHOTO_URL}?v=${encodeURIComponent(avatarId)}`;
}

export async function getAccountTheme(signal?: AbortSignal): Promise<AccountThemeView> {
  return requestDecoded(
    "/api/theme",
    "account.theme",
    (body) => parseAccountThemeView(envelopeField(body, "theme")),
    signal ? { signal } : undefined,
  );
}

export async function writeAccountTheme(
  expectedRevision: number,
  theme: AccountTheme,
  actionId: string,
): Promise<AccountThemeView> {
  return requestDecoded(
    "/api/theme",
    "account.theme-write",
    (body) => parseAccountThemeView(envelopeField(body, "theme")),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision, theme, actionId }),
    },
  );
}

export { errorMessage };
export type { AccountTheme, AccountThemeView, AvatarUploadView, ProfileView };
