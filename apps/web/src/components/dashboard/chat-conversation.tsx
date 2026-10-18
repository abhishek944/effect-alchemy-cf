import { useEffect, useMemo, type RefObject } from "react";
import {
  AssistantRuntimeProvider,
  MessageNotSentError,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import { useChatStore } from "@/lib/chat-store-context";
import { useSpeechAdapters } from "@/lib/chat-speech-adapters";
import ChatFooter from "./chat-footer";
import ChatMessageList from "./chat-message-list";
import { HistoryControls, HistoryUiProvider } from "./chat-history-ui";
import ChatNotices from "./chat-notices";
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
  const { snapshot, pendingSend, stopping, connection, selectedId, chats, attachment } = store;
  const chatId = snapshot?.chat.id ?? selectedId ?? "none";
  const pending = pendingSend?.chatId === chatId ? pendingSend : null;
  const otherPending = pendingSend && pendingSend.chatId !== chatId ? pendingSend : null;
  const otherTitle = otherPending
    ? (chats.find((chat) => chat.id === otherPending.chatId)?.title ?? "another chat")
    : null;
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
  const { attachmentsFor, factsFor, stampFor } = useChatFacts(
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
      const outcome = await store.send(appendText(message), chatId);
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
    ? stoppingHere
      ? "Stopping the current answer…"
      : `Stopping the answer in "${stopping.title}"…`
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
    stoppingTitle: stopping?.title ?? null,
    otherTitle,
    pendingHere: Boolean(pending),
    running,
    archived,
  });

  return (
    <HistoryUiProvider
      value={{
        textFor: history.textForById,
        attachmentsFor,
        stampFor,
        factsFor,
        working,
        copyAllowed: connected && !running && !runError && !history.error,
      }}
    >
      <VoiceProvider bundle={voice}>
        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root data-cx="chat-thread" aria-label="Assistant chat">
            <ThreadPrimitive.Viewport data-cx="chat-viewport">
              <HistoryControls
                gap={history.gap}
                newerUnloaded={history.newerUnloaded}
                hasOlder={history.hasOlder}
                loading={history.loading}
                error={history.error}
                onLoadOlder={history.loadOlder}
                onLoadMissing={history.loadMissing}
                onReturnToLatest={history.returnToLatest}
              />
              <ChatMessageList />
              {snapshot && history.rows.length + history.live.length === 0 && !running && (
                <p data-cx="chat-empty">
                  {archived ? "This chat has no messages." : "Ask anything to start this chat."}
                </p>
              )}
            </ThreadPrimitive.Viewport>
            {runError && (
              <p data-cx="chat-error" role="alert">
                {runError}
              </p>
            )}
            {store.actionError && (
              <p data-cx="chat-error" data-kind="action" role="alert">
                {store.actionError}
              </p>
            )}
            <ChatNotices chatId={chatId} otherTitle={otherTitle} />
            <ChatFooter
              archived={archived}
              chatId={chatId}
              running={running}
              status={status}
              announcement={announcement}
              announce={!runError && pending?.phase !== "failed"}
              stopLabel={stopLabel}
              sendLabel={sendLabel}
              stopping={stoppingHere}
              onStop={onStop}
              onRetry={connection === "error" ? store.reload : undefined}
            />
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
      </VoiceProvider>
    </HistoryUiProvider>
  );
}
