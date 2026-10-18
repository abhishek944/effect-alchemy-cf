/**
 * Dedicated Voice settings section.
 *
 * Two clearly named groups expose the exact native transcription, read-aloud
 * and compatible-voice sets. Every explicit change saves to the account with
 * the loaded revision; a conflict refreshes the saved values instead of
 * overwriting, and failures stay visible. Opening or changing the page never
 * runs a paid provider preview.
 */
import { useCallback, useEffect, useState } from "react";
import { ChatApiError } from "@/lib/chat-api";
import type {
  ChatSpeechPreferences,
  ChatSpeechPreferencesView,
} from "@/lib/chat-capability-speech-types";
import {
  fetchSpeechPreferences,
  saveSpeechPreferences,
  speechRequestError,
} from "@/lib/chat-speech-client";
import { speechDictationSupport } from "@/lib/chat-speech-recorder";
import {
  SpeechModelSelect,
  TranscriptionModelSelect,
  VoiceRow,
  VoiceSelect,
  compatibleVoiceFor,
} from "./voice-settings-rows";
import "./voice-settings.css";

const support = speechDictationSupport();

export default function VoiceSettings() {
  const [view, setView] = useState<ChatSpeechPreferencesView | null>(null);
  const [draft, setDraft] = useState<ChatSpeechPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) return;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await fetchSpeechPreferences(signal);
      if (signal?.aborted) return;
      setView(next);
      setDraft(next.preferences);
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(speechRequestError(error));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  const persist = useCallback(
    async (next: ChatSpeechPreferences): Promise<void> => {
      if (view === null) return;
      setSaving(true);
      setSaveError(null);
      setNotice(null);
      try {
        const updated = await saveSpeechPreferences({
          expectedRevision: view.preferences.revision,
          transcriptionModel: next.transcriptionModel,
          speechModel: next.speechModel,
          voice: next.voice,
        });
        setView(updated);
        setDraft(updated.preferences);
        setNotice("Saved to your account.");
      } catch (error) {
        if (error instanceof ChatApiError && error.status === 409) {
          setNotice("Voice preferences changed in another tab. Reloaded the saved values.");
          void load();
        } else {
          setSaveError(speechRequestError(error));
        }
      } finally {
        setSaving(false);
      }
    },
    [view, load],
  );

  if (loading && view === null)
    return <output data-cx="voice-status">Loading voice settings…</output>;
  if (view === null || draft === null)
    return (
      <div data-cx="voice-notice" role="alert">
        <strong>Voice settings are unavailable.</strong>
        <p>{loadError ?? "The saved preferences could not be read."}</p>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  const current = draft;
  const choose = (next: ChatSpeechPreferences): void => {
    setDraft(next);
    void persist(next);
  };
  const status =
    saveError ?? (loading ? "Refreshing saved settings…" : saving ? "Saving…" : notice);
  return (
    <>
      <p data-cx="voice-intro">
        Saved to your account across devices. Changes apply to your next recording or Play. No paid
        preview runs when you open or change this page.
      </p>
      <section aria-label="Dictation" data-cx="settings-group">
        <h2 data-cx="settings-group-title">Dictation</h2>
        <dl data-cx="settings-card">
          <VoiceRow
            description={
              support.supported
                ? "Turns your recording into an editable draft."
                : (support.reason ?? "Recording is unavailable.")
            }
            label="Transcription model"
          >
            <TranscriptionModelSelect
              disabled={saving}
              onChange={(model) => choose({ ...current, transcriptionModel: model })}
              value={current.transcriptionModel}
            />
          </VoiceRow>
        </dl>
      </section>
      <section aria-label="Read aloud" data-cx="settings-group">
        <h2 data-cx="settings-group-title">Read aloud</h2>
        <dl data-cx="settings-card">
          <VoiceRow
            description="Speaks a complete reply when you press Play."
            label="Read-aloud model"
          >
            <SpeechModelSelect
              disabled={saving}
              onChange={(model) =>
                choose({
                  ...current,
                  speechModel: model,
                  voice: compatibleVoiceFor(model, current.voice),
                })
              }
              value={current.speechModel}
            />
          </VoiceRow>
          <VoiceRow
            description="Only voices supported by the read-aloud model are listed."
            label="Voice"
          >
            <VoiceSelect
              disabled={saving}
              model={current.speechModel}
              onChange={(voice) => choose({ ...current, voice })}
              value={current.voice}
            />
          </VoiceRow>
        </dl>
      </section>
      <p data-cx="voice-disclosure">
        Read aloud uses an AI-generated voice. Playing or replaying a reply may cost an additional
        speech charge.
      </p>
      {status !== null && (
        <output aria-live="polite" data-cx="voice-status">
          {status}
        </output>
      )}
      {saveError !== null && (
        <button data-cx="voice-retry" type="button" onClick={() => void persist(current)}>
          Try saving again
        </button>
      )}
    </>
  );
}
