export const IMAGE_MODEL_OPTIONS = [
  { value: "flare", label: "Flare" },
  { value: "sunburst", label: "Sunburst" },
] as const;
export const IMAGE_SIZE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "1024x1024", label: "Square" },
  { value: "1024x1536", label: "Portrait" },
  { value: "1536x1024", label: "Landscape" },
] as const;
export const IMAGE_QUALITY_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
] as const;

export type ImagePreferenceChoices = {
  readonly model: (typeof IMAGE_MODEL_OPTIONS)[number]["value"];
  readonly size: (typeof IMAGE_SIZE_OPTIONS)[number]["value"];
  readonly quality: (typeof IMAGE_QUALITY_OPTIONS)[number]["value"];
};
export type ImagePreferences = ImagePreferenceChoices & {
  readonly version: 1;
  readonly revision: number;
};
export type ImagePreferencesView = {
  readonly preferences: ImagePreferences;
  readonly source: "default" | "explicit";
  /** Binding/route configuration only; live provider entitlement remains unverified. */
  readonly configurationReady: boolean;
};
export type ImagePreferencesWrite = ImagePreferenceChoices & {
  readonly expectedRevision: number;
};

export const imagePreferenceSummary = (value: ImagePreferenceChoices): string => {
  const model = IMAGE_MODEL_OPTIONS.find((option) => option.value === value.model)?.label;
  const size = IMAGE_SIZE_OPTIONS.find((option) => option.value === value.size)?.label;
  const quality = IMAGE_QUALITY_OPTIONS.find((option) => option.value === value.quality)?.label;
  return `${model} · ${size} shape · ${quality} quality`;
};
