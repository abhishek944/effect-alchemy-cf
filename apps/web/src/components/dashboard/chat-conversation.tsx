import { useEffect, useMemo, type RefObject } from "react";
import {
  AssistantRuntimeProvider,
  MessageNotSentError,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import { useChatStore } from "@/lib/chat-store-context";
import { useSpeechAdapters } from "@/lib/chat-speech-adapters";
import { HistoryUiProvider } from "./chat-history-ui";
import { ChatConversationView } from "./chat-conversation-view";
import { ChatReferenceFocusProvider } from "./chat-reference-focus";
import { useReferenceWorkspace } from "./reference-workspace";
import { appendText, convertMessage, projectMessages } from "./chat-projection";
import { composerSendLabel, composerStatus } from "./chat-composer-status";
import { useChatFacts } from "./use-chat-facts";
import { useChatHistory } from "./use-chat-history";
import { VoiceProvider } from "./chat-voice-bridge";
import "./chat.css";

/** Runtime, thread and footer wiring for one selected chat. */
export default function ChatConversation({
  draftsRef,
  active,
}: {
  draftsRef: RefObject<Map<string, string>>;
  active: boolean;
}) {
  const store = useChatStore();
  const references = useReferenceWorkspace();
  const { snapshot, pendingSend, stopping, connection, selectedId, attachment } = store;
  const chatId = snapshot?.chat.id ?? selectedId ?? "none";
  const pending = pendingSend?.chatId === chatId ? pendingSend : null;
  const stoppingHere = stopping?.chatId === chatId;
  const running = Boolean(snapshot?.isRunning) || pending?.phase === "accepted";
  const archived = Boolean(snapshot?.chat.archived);
  const connected = Boolean(snapshot) && connection === "live";
  const canSend = connected && !archived && !running && !pendingSend && !stopping;
  const stopOperation =
    snapshot?.activeOperationId ?? (pending?.phase === "accepted" ? pending.operationId : null);
  const stopRef =
    stopOperation && chatId !== "none"
      ? { chatId, operationId: stopOperation, title: snapshot?.chat.title ?? "this chat" }
      : null;
  const requestStop = () => {
    if (stopRef && !stopping) void store.stop(stopRef);
  };
  const history = useChatHistory(selectedId, attachment, snapshot, store.acknowledgeOperations);
  const messages = useMemo(
    () => projectMessages(history.rows, history.live, pending, selectedId, history.textFor),
    [history.rows, history.live, history.textFor, pending, selectedId],
  );
  const voice = useSpeechAdapters({ chatId: () => selectedId });
  const { attachmentsFor, selectionsFor, generatedFor, factsFor, stampFor } = useChatFacts(
    history.rows,
    history.live,
    Boolean(snapshot?.isRunning),
  );
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: running,
    isSendDisabled: !canSend,
    adapters: { dictation: voice.dictation, speech: voice.speech },
    onNew: async (message: AppendMessage) => {
      if (runtime.thread.composer.getState().dictation) {
        throw new MessageNotSentError("Stop or cancel dictation before sending.");
      }
      const text = appendText(message);
      const draft = references.editor(chatId)?.read();
      if (draft && draft.text !== text)
        throw new MessageNotSentError("The reference draft changed.");
      const outcome = await store.send(text, chatId, draft?.inputs);
      if (outcome.status === "blocked") throw new MessageNotSentError(outcome.message);
    },
    onCancel: async () => {
      requestStop();
    },
  });

  useEffect(() => {
    const drafts = draftsRef.current;
    runtime.thread.composer.setText(drafts.get(chatId) ?? "");
    return () => {
      if (chatId !== "none") drafts.set(chatId, runtime.thread.composer.getState().text);
    };
  }, [runtime, chatId, draftsRef]);

  // Leaving the visible conversation cancels owned audio only: drafts, files and
  // accepted Pi work stay untouched, and the chat/account unmount still disposes.
  useEffect(() => {
    if (active) return;
    voice.cancelDictation();
    voice.stopPlayback();
  }, [active, voice]);

  const runError = snapshot?.error ?? store.connectionError;
  const working =
    connected &&
    Boolean(snapshot?.isRunning && snapshot.activeOperationId) &&
    !runError &&
    !stoppingHere &&
    !history.newerUnloaded;
  const answerStarted = history.live.some(
    (message) => message.role === "assistant" && history.textFor(message).text.length > 0,
  );
  const announcement =
    pending?.phase === "accepted"
      ? "Sent to the assistant. Waiting for this run to start."
      : working
        ? answerStarted
          ? "The answer has started."
          : "Working"
        : "";
  const stopLabel = stopping
    ? "Stopping the current answer…"
    : stopRef
      ? "Stop the current answer"
      : "Waiting for the run to identify itself before it can be stopped";
  const onStop = running && stopRef && !stopping ? requestStop : undefined;
  const status = composerStatus({
    hasSnapshot: Boolean(snapshot),
    connection,
    stoppingHere,
    archived,
    posting: pending?.phase === "posting",
  });
  const sendLabel = composerSendLabel({
    canSend,
    stoppingHere: Boolean(stopping),
    pendingHere: Boolean(pending),
    running,
    archived,
  });

  return (
    <HistoryUiProvider
      value={{
        textFor: history.textForById,
        attachmentsFor,
        selectionsFor,
        generatedFor,
        active,
        stampFor,
        factsFor,
        working,
        copyAllowed: connected && !running && !runError && !history.error,
      }}
    >
      <VoiceProvider bundle={voice}>
        <ChatReferenceFocusProvider>
          <AssistantRuntimeProvider runtime={runtime}>
            <ChatConversationView
              history={history}
              snapshot={snapshot}
              running={running}
              archived={archived}
              runError={runError}
              actionError={store.actionError}
              chatId={chatId}
              footer={{
                archived,
                chatId,
                running,
                status,
                reconnecting:
                  Boolean(snapshot) && connection === "reconnecting" && !stoppingHere && !archived,
                announcement,
                announce: !runError && pending?.phase !== "failed",
                stopLabel,
                sendLabel,
                stopping: stoppingHere,
                onStop,
                onRetry: connection === "error" ? store.reload : undefined,
              }}
            />
          </AssistantRuntimeProvider>
        </ChatReferenceFocusProvider>
      </VoiceProvider>
    </HistoryUiProvider>
  );
}
