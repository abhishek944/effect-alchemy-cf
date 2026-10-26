import { useState, type ClipboardEvent, type DragEvent } from "react";
import { ComposerPrimitive } from "@assistant-ui/react";
import { useChatStore } from "@/lib/chat-store-context";
import ChatComposerActions from "./chat-composer-actions";
import ChatComposerFiles from "./chat-composer-files";
import { useVoice } from "./chat-voice-bridge";
import { useChatSubmit } from "./use-chat-submit";
import ChatSkillsReadinessNotice from "./chat-skills-readiness-notice";
import VoiceRecorder from "./voice-recorder";
import { ChatReferenceInput } from "./chat-reference-input";
import { ReferenceTray } from "./reference-tray";
import "./chat-composer.css";

type Props = {
  chatId: string;
  running: boolean;
  stopLabel: string;
  sendLabel: string;
  stopping: boolean;
  onStop?: (() => void) | undefined;
};

/**
 * The 118px composer body: optional staged files, the auto-growing input, then
 * the fixed action row. Picker, paste and drop share the same local validation,
 * and ordinary pasted text remains draft text.
 *
 * The form submission is app-owned so ordinary Enter uses exactly the same
 * admission and dispatch callback as the Send button; Shift+Enter and IME
 * still reach the native input untouched.
 */
export default function ChatComposer({ chatId, running, stopping, ...actions }: Props) {
  const store = useChatStore();
  const { stagedFiles } = store;
  const voice = useVoice();
  const [dragging, setDragging] = useState(false);
  const {
    submit,
    canSend,
    blockedReason,
    readinessFeedback,
    skillsNotice,
    skillsChecking,
    recheckSkills,
  } = useChatSubmit({ chatId, running, stopping });

  const addFiles = (files: File[]) => {
    if (files.length > 0) stagedFiles.add(files);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    addFiles(files);
    if (!event.clipboardData?.getData("text/plain")) event.preventDefault();
  };

  return (
    <>
      <ChatSkillsReadinessNotice
        message={skillsNotice}
        checking={skillsChecking}
        onRetry={() => void recheckSkills()}
      />
      <ReferenceTray chatId={chatId} />
      <div
        data-cx="composer-shell"
        data-dragging={dragging ? "true" : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        <ComposerPrimitive.Root
          data-cx="chat-composer"
          onSubmit={(event) => {
            // Preventing the native handler replaces assistant-ui's empty runtime
            // attachment gate, which could not see the composer's staged files.
            event.preventDefault();
            void submit();
          }}
        >
          <ChatComposerFiles
            files={stagedFiles.files}
            lockedIds={
              store.pendingSend?.chatId === chatId
                ? (store.pendingSend.frozen?.attachments ?? [])
                : []
            }
            notice={stagedFiles.notice}
            onRemove={stagedFiles.remove}
            onClearNotice={stagedFiles.clearNotice}
          />
          {voice && <VoiceRecorder bundle={voice.bundle} />}
          <ChatReferenceInput chatId={chatId} />
          <ChatComposerActions
            {...actions}
            running={running}
            stopping={stopping}
            submit={submit}
            canSend={canSend}
            blockedReason={blockedReason}
            addFiles={addFiles}
          />
          {readinessFeedback && (
            <p data-cx="setup-error" role="alert">
              {readinessFeedback}
            </p>
          )}
        </ComposerPrimitive.Root>
      </div>
    </>
  );
}
