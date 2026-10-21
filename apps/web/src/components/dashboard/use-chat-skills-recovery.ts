import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { errorMessage, type ChatSnapshot } from "@/lib/chat-api";
import { newSkillSend, retrySkillOperation } from "@/lib/chat-skills-api";
import {
  clearNewSendCommand,
  isExactNoAdmission,
  readNewSendCommand,
  retryKeyFor,
  sameSelection,
  writeNewSendCommand,
  type NewSendCommand,
} from "@/lib/chat-skills-recovery-identity";
import type { ChatSelection } from "@/lib/chat-capability-types";

type Busy = "retry" | "new-send" | null;
type ActionState = { key: string; busy: Busy; notice: string | null };

/** One rendered recovery target, frozen by the caller at click time. */
export type SkillRecoveryTarget = {
  readonly chatId: string;
  readonly logicalOperationId: string;
  readonly failedAttemptId: string;
  readonly canRetry: boolean;
};

const STORAGE_REFUSED =
  "This session cannot start a new uncertain New Send right now; resolve or reload the earlier one first.";
const UNREADABLE =
  "The pending New Send for this answer could not be read safely, so no new one was started.";

/** Rendered-target recovery actions; see the outcome-scope notes below. */
export function useChatSkillsRecovery(options: {
  snapshot: ChatSnapshot | null;
  reload: () => void;
  onError: (message: string | null) => void;
}) {
  const recovery = options.snapshot?.skillRecovery ?? null;
  const chatId = options.snapshot?.chat.id ?? null;
  const target: SkillRecoveryTarget | null =
    recovery === null || chatId === null
      ? null
      : {
          chatId,
          logicalOperationId: recovery.logicalOperationId,
          failedAttemptId: recovery.failedAttemptId,
          canRetry: recovery.canRetry,
        };
  const targetKey = target === null ? "" : `${target.chatId}:${target.failedAttemptId}`;
  const [state, setState] = useState<ActionState>({ key: targetKey, busy: null, notice: null });
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const commandsRef = useRef(new Map<string, NewSendCommand>());
  const latestRef = useRef({ snapshot: options.snapshot });
  const callbacksRef = useRef({ reload: options.reload, onError: options.onError });
  useLayoutEffect(() => {
    latestRef.current = { snapshot: options.snapshot };
    callbacksRef.current = { reload: options.reload, onError: options.onError };
  });
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyOutcome = (
    expected: SkillRecoveryTarget,
    key: string,
    failure: string | null,
    frozenNotice: string | null,
  ): void => {
    const notice =
      failure === null ? null : frozenNotice === null ? failure : `${failure} ${frozenNotice}`;
    setState({ key, busy: null, notice });
    if (!mountedRef.current) return;
    const snapshot = latestRef.current.snapshot;
    if (snapshot?.chat.id !== expected.chatId) return;
    if (failure !== null) {
      const attempt = snapshot.skillRecovery;
      if (
        attempt?.logicalOperationId !== expected.logicalOperationId ||
        attempt.failedAttemptId !== expected.failedAttemptId
      )
        return;
      callbacksRef.current.onError(failure);
    }
    callbacksRef.current.reload();
  };

  const retry = useCallback(async (expected: SkillRecoveryTarget) => {
    const key = `${expected.chatId}:${expected.failedAttemptId}`;
    if (busyRef.current) return;
    if (!expected.canRetry) {
      setState({
        key,
        busy: null,
        notice: "The original skills are no longer available. Use New Send with current skills.",
      });
      return;
    }
    busyRef.current = true;
    setState({ key, busy: "retry", notice: null });
    let failure: string | null = null;
    try {
      const retryKey = await retryKeyFor(expected.logicalOperationId, expected.failedAttemptId);
      await retrySkillOperation(expected.chatId, {
        logicalOperationId: expected.logicalOperationId,
        failedAttemptId: expected.failedAttemptId,
        retryKey,
      });
    } catch (error) {
      failure = errorMessage(error);
    } finally {
      busyRef.current = false;
      applyOutcome(expected, key, failure, null);
    }
  }, []);

  const newSend = useCallback(
    async (expected: SkillRecoveryTarget, selection: ChatSelection | null) => {
      const key = `${expected.chatId}:${expected.failedAttemptId}`;
      if (busyRef.current) return;
      let command = commandsRef.current.get(key);
      if (command === undefined) {
        const read = readNewSendCommand(expected.chatId, {
          logicalOperationId: expected.logicalOperationId,
          failedAttemptId: expected.failedAttemptId,
        });
        if (read.kind === "unreadable") {
          setState({ key, busy: null, notice: UNREADABLE });
          return;
        }
        if (read.kind === "command") command = read.command;
      }
      const creating = command === undefined;
      if (command === undefined && selection === null) {
        setState({
          key,
          busy: null,
          notice: "Choose a model and effort before sending with current skills.",
        });
        return;
      }
      if (command === undefined && selection !== null) {
        command = {
          operationId: crypto.randomUUID(),
          sourceOperationId: expected.logicalOperationId,
          sourceAttemptId: expected.failedAttemptId,
          selection,
        };
      }
      if (command === undefined) return;
      if (
        creating &&
        writeNewSendCommand(expected.chatId, expected.failedAttemptId, command) !== "saved"
      ) {
        setState({ key, busy: null, notice: STORAGE_REFUSED });
        return;
      }
      commandsRef.current.set(key, command);
      const frozenNotice =
        selection !== null && !sameSelection(command.selection, selection)
          ? `Frozen model ${command.selection.model} (${command.selection.effort}) from the earlier New Send.`
          : null;
      busyRef.current = true;
      setState({
        key,
        busy: "new-send",
        notice: frozenNotice === null ? null : "Reconciling with the earlier New Send.",
      });
      let failure: string | null = null;
      try {
        await newSkillSend(expected.chatId, command);
        if (commandsRef.current.get(key)?.operationId === command.operationId) {
          commandsRef.current.delete(key);
          clearNewSendCommand(expected.chatId, expected.failedAttemptId, command.operationId);
        }
      } catch (error) {
        failure = errorMessage(error);
        if (isExactNoAdmission(error, command)) {
          commandsRef.current.delete(key);
          clearNewSendCommand(expected.chatId, expected.failedAttemptId, command.operationId);
        }
      } finally {
        busyRef.current = false;
        applyOutcome(expected, key, failure, frozenNotice);
      }
    },
    [],
  );

  return {
    recovery,
    target,
    busy: state.key === targetKey ? state.busy : null,
    notice: state.key === targetKey ? state.notice : null,
    retry,
    newSend,
  };
}
