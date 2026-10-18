/**
 * Presentational rows for the dedicated Voice settings section.
 *
 * Selects expose only the exact native model ids and the voice set compatible
 * with the selected read-aloud model; changing the model repairs an
 * incompatible stored voice to the first supported voice instead of saving an
 * invalid pair.
 */
import type { ReactNode } from "react";
import { DropdownSelect } from "./dropdown";
import {
  SPEECH_MODELS,
  TRANSCRIPTION_MODELS,
  nativeVoicesForSpeechModel,
  type ChatSpeechModel,
  type ChatSpeechVoice,
  type ChatTranscriptionModel,
} from "@/lib/chat-capability-speech-types";

export function VoiceRow({
  label,
  description,
  children,
}: {
  readonly label: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <div data-cx="settings-row">
      <dt data-cx="settings-row-label">
        {label}
        <span data-cx="settings-row-description">{description}</span>
      </dt>
      <dd data-cx="settings-row-control">{children}</dd>
    </div>
  );
}

export const compatibleVoiceFor = (
  model: ChatSpeechModel,
  voice: ChatSpeechVoice,
): ChatSpeechVoice => {
  const voices = nativeVoicesForSpeechModel(model);
  return voices.find((candidate) => candidate === voice) ?? voices[0] ?? "en_paul_neutral";
};

export function TranscriptionModelSelect({
  value,
  disabled,
  onChange,
}: {
  readonly value: ChatTranscriptionModel;
  readonly disabled: boolean;
  readonly onChange: (model: ChatTranscriptionModel) => void;
}) {
  return (
    <DropdownSelect
      aria-label="Transcription model"
      data-cx="voice-select"
      disabled={disabled}
      onChange={(event) => {
        const model = TRANSCRIPTION_MODELS.find((candidate) => candidate === event.target.value);
        if (model !== undefined) onChange(model);
      }}
      value={value}
    >
      {TRANSCRIPTION_MODELS.map((model) => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
    </DropdownSelect>
  );
}

export function SpeechModelSelect({
  value,
  disabled,
  onChange,
}: {
  readonly value: ChatSpeechModel;
  readonly disabled: boolean;
  readonly onChange: (model: ChatSpeechModel) => void;
}) {
  return (
    <DropdownSelect
      aria-label="Read-aloud model"
      data-cx="voice-select"
      disabled={disabled}
      onChange={(event) => {
        const model = SPEECH_MODELS.find((candidate) => candidate === event.target.value);
        if (model !== undefined) onChange(model);
      }}
      value={value}
    >
      {SPEECH_MODELS.map((model) => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
    </DropdownSelect>
  );
}

export function VoiceSelect({
  model,
  value,
  disabled,
  onChange,
}: {
  readonly model: ChatSpeechModel;
  readonly value: ChatSpeechVoice;
  readonly disabled: boolean;
  readonly onChange: (voice: ChatSpeechVoice) => void;
}) {
  const voices = nativeVoicesForSpeechModel(model);
  return (
    <DropdownSelect
      aria-label="Voice"
      data-cx="voice-select"
      disabled={disabled}
      onChange={(event) => {
        const voice = voices.find((candidate) => candidate === event.target.value);
        if (voice !== undefined) onChange(voice);
      }}
      value={value}
    >
      {voices.map((voice) => (
        <option key={voice} value={voice}>
          {voice}
        </option>
      ))}
    </DropdownSelect>
  );
}
