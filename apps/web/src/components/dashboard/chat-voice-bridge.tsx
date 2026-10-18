import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  speechDictationSupport,
  type SpeechAdapterBundle,
  type SpeechAdapterState,
} from "@/lib/chat-speech-adapters";

export type VoiceBridge = {
  readonly bundle: SpeechAdapterBundle;
  readonly supported: boolean;
  readonly reason: string | null;
};

const VoiceContext = createContext<VoiceBridge | null>(null);

/**
 * One speech adapter bundle per mounted conversation. The bundle is created
 * here so the same instance feeds the runtime adapters, the recorder region and
 * the speaker buttons; chat changes remount this subtree and dispose it.
 */
export function VoiceProvider({
  bundle,
  children,
}: {
  bundle: SpeechAdapterBundle;
  children: ReactNode;
}) {
  const value = useMemo<VoiceBridge>(() => {
    const support = speechDictationSupport();
    return { bundle, supported: support.supported, reason: support.reason };
  }, [bundle]);
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceBridge | null {
  return useContext(VoiceContext);
}

const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;
const NO_STATE = (): SpeechAdapterState | null => null;

/** Live local playback status for the speaker button; null without a bundle. */
export function useVoicePlayback(): SpeechAdapterState | null {
  const voice = useVoice();
  const bundle = voice?.bundle ?? null;
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => bundle?.subscribe(listener) ?? NOOP_SUBSCRIBE(),
      [bundle],
    ),
    useCallback(() => bundle?.getState() ?? NO_STATE(), [bundle]),
  );
}
