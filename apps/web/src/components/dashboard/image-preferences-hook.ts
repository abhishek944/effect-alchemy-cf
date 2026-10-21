import { useCallback, useEffect, useRef, useState } from "react";
import { ChatApiError, errorMessage } from "@/lib/chat-api";
import { fetchImagePreferences, saveImagePreferences } from "@/lib/image-preferences-client";
import type { ImagePreferenceChoices, ImagePreferencesView } from "@/lib/image-preferences-types";

export type ImagePreferencesPhase =
  | "loading"
  | "ready"
  | "saving"
  | "save-error"
  | "refreshing"
  | "conflict"
  | "read-error";

type PreferencesState = {
  readonly view: ImagePreferencesView | null;
  readonly draft: ImagePreferenceChoices | null;
  readonly phase: ImagePreferencesPhase;
  readonly error: string | null;
  readonly conflicted: boolean;
};

/** Confirmed account values never come from an attempted or malformed write. */
export function useImagePreferences() {
  const [state, setState] = useState<PreferencesState>({
    view: null,
    draft: null,
    phase: "loading",
    error: null,
    conflicted: false,
  });
  const operation = useRef<AbortController | null>(null);

  const load = useCallback(async (conflicted = false): Promise<void> => {
    if (operation.current !== null) return;
    const controller = new AbortController();
    operation.current = controller;
    setState((previous) => ({ ...previous, phase: "loading", error: null }));
    try {
      const view = await fetchImagePreferences(controller.signal);
      if (controller.signal.aborted) return;
      setState((previous) => ({
        view,
        draft: previous.draft ?? view.preferences,
        phase: conflicted ? "conflict" : "ready",
        error: null,
        conflicted,
      }));
    } catch (error) {
      if (!controller.signal.aborted)
        setState((previous) => ({ ...previous, phase: "read-error", error: errorMessage(error) }));
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      operation.current?.abort();
      operation.current = null;
    };
  }, [load]);

  const persist = useCallback(
    async (draft: ImagePreferenceChoices): Promise<void> => {
      if (
        state.view === null ||
        operation.current !== null ||
        !["ready", "save-error", "conflict"].includes(state.phase)
      )
        return;
      const controller = new AbortController();
      operation.current = controller;
      setState((previous) => ({ ...previous, draft, phase: "saving", error: null }));
      try {
        const view = await saveImagePreferences(
          { ...draft, expectedRevision: state.view.preferences.revision },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setState({ view, draft: view.preferences, phase: "ready", error: null, conflicted: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ChatApiError && error.status === 409) {
          setState((previous) => ({
            ...previous,
            phase: "refreshing",
            conflicted: true,
            error: null,
          }));
          try {
            const view = await fetchImagePreferences(controller.signal);
            if (!controller.signal.aborted)
              setState({ view, draft, phase: "conflict", error: null, conflicted: true });
          } catch (readError) {
            if (!controller.signal.aborted)
              setState((previous) => ({
                ...previous,
                phase: "read-error",
                error: errorMessage(readError),
              }));
          }
        } else {
          setState((previous) => ({
            ...previous,
            phase: "save-error",
            error: errorMessage(error),
          }));
        }
      } finally {
        if (operation.current === controller) operation.current = null;
      }
    },
    [state.view, state.phase],
  );

  return {
    ...state,
    busy: ["loading", "saving", "refreshing"].includes(state.phase),
    choose: (draft: ImagePreferenceChoices) => void persist(draft),
    retrySave: () => {
      if (state.draft !== null) void persist(state.draft);
    },
    reload: () => void load(state.conflicted),
  };
}

export type ImagePreferencesController = ReturnType<typeof useImagePreferences>;
