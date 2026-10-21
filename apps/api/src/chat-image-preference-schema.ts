import { Schema } from "effect";

// Safe aliases only. The native integration resolves the trusted package route.
export const IMAGE_MODELS = ["flare", "sunburst"] as const;
export const IMAGE_SIZES = ["auto", "1024x1024", "1024x1536", "1536x1024"] as const;
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
export const DEFAULT_IMAGE_PREFERENCES = {
  model: "flare",
  size: "auto",
  quality: "auto",
} as const;

const ImageRevision = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
);
const choices = {
  model: Schema.Literals(IMAGE_MODELS),
  size: Schema.Literals(IMAGE_SIZES),
  quality: Schema.Literals(IMAGE_QUALITIES),
};

export const ImagePreferences = Schema.Struct({
  version: Schema.Literal(1),
  revision: ImageRevision,
  ...choices,
});
export type ImagePreferences = typeof ImagePreferences.Type;

export const ImagePreferencesView = Schema.Struct({
  preferences: ImagePreferences,
  source: Schema.Literals(["default", "explicit"]),
});
export type ImagePreferencesView = typeof ImagePreferencesView.Type;

/** Public read projection, not durable response capability or provider eligibility. */
export const ImagePreferencesPublicView = Schema.Struct({
  ...ImagePreferencesView.fields,
  configurationReady: Schema.Boolean,
});

export const ImagePreferencesWrite = Schema.Struct({
  expectedRevision: ImageRevision,
  ...choices,
});
export type ImagePreferencesWrite = typeof ImagePreferencesWrite.Type;

export const initialImagePreferences = (): ImagePreferences => ({
  version: 1,
  revision: 0,
  ...DEFAULT_IMAGE_PREFERENCES,
});
