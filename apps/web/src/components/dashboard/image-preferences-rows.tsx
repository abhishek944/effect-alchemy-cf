import { useId } from "react";
import {
  IMAGE_MODEL_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  type ImagePreferenceChoices,
} from "@/lib/image-preferences-types";
import { DropdownSelect } from "./dropdown";

function PreferenceRow<T extends string>({
  label,
  description,
  options,
  value,
  disabled,
  onChange,
  noticeId,
}: {
  readonly label: string;
  readonly description: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
  readonly noticeId?: string | undefined;
}) {
  const id = useId();
  return (
    <div data-cx="settings-row">
      <dt data-cx="settings-row-label">
        <label htmlFor={id}>{label}</label>
        <span data-cx="settings-row-description" id={`${id}-description`}>
          {description}
        </span>
      </dt>
      <dd data-cx="settings-row-control">
        <DropdownSelect
          aria-describedby={`${id}-description${noticeId ? ` ${noticeId}` : ""}`}
          data-cx="image-preferences-select"
          disabled={disabled}
          id={id}
          onChange={(event) => {
            const selected = options.find((option) => option.value === event.target.value);
            if (selected !== undefined) onChange(selected.value);
          }}
          value={value}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </DropdownSelect>
      </dd>
    </div>
  );
}

export function ImagePreferencesRows({
  draft,
  disabled,
  choose,
  noticeId,
}: {
  readonly draft: ImagePreferenceChoices;
  readonly disabled: boolean;
  readonly choose: (next: ImagePreferenceChoices) => void;
  readonly noticeId?: string | undefined;
}) {
  return (
    <>
      <PreferenceRow
        description="The model that draws or edits your images. Separate from your chat model."
        disabled={disabled}
        label="Image model"
        noticeId={noticeId}
        onChange={(model) => choose({ ...draft, model })}
        options={IMAGE_MODEL_OPTIONS}
        value={draft.model}
      />
      <PreferenceRow
        description="Auto lets the AI choose a supported shape."
        disabled={disabled}
        label="Shape"
        noticeId={noticeId}
        onChange={(size) => choose({ ...draft, size })}
        options={IMAGE_SIZE_OPTIONS}
        value={draft.size}
      />
      <PreferenceRow
        description="Auto lets the AI choose. Higher settings can cost more."
        disabled={disabled}
        label="Quality"
        noticeId={noticeId}
        onChange={(quality) => choose({ ...draft, quality })}
        options={IMAGE_QUALITY_OPTIONS}
        value={draft.quality}
      />
    </>
  );
}
