/** Catalog-backed model/effort selection for one chat. The server is authoritative. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSelection } from "@/lib/chat-capability-types";
import { capabilityMessage, getChatPreferences } from "@/lib/chat-capability-api";
import { planModelChoice } from "@/lib/chat-selection-labels";
import type { ChatSelectionControls } from "@/lib/chat-store-context";
import {
  loadStatus,
  type SetupRecord,
  type StagedRecord,
  type WriteRecord,
} from "./chat-preference-records";
import { runPreferenceWrite } from "./chat-preference-write";
import { useChatCatalogDefaults } from "./use-chat-catalog-defaults";

export function useChatPreferences(chatId: string | null): ChatSelectionControls {
  const [setup, setSetup] = useState<SetupRecord | null>(null);
  const [writes, setWrites] = useState<WriteRecord | null>(null);
  const [staged, setStaged] = useState<StagedRecord | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const savingForRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const { catalog, catalogError, accountDefault, setAccountDefault } =
    useChatCatalogDefaults(reloadKey);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const chatKey = `${chatId ?? ""}|${reloadKey}`;
  useEffect(() => {
    if (!chatId) return undefined;
    const controller = new AbortController();
    let active = true;
    const load = async () => {
      try {
        const view = await getChatPreferences(chatId);
        if (active)
          setSetup({
            key: chatKey,
            selection: view.preferences.preferred,
            efforts: view.preferences.modelEfforts,
            revision: view.preferences.revision,
            error: null,
          });
      } catch (cause) {
        if (active && !controller.signal.aborted)
          setSetup({
            key: chatKey,
            selection: null,
            efforts: [],
            revision: 0,
            error: capabilityMessage(cause, "Loading this chat's model settings"),
          });
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
      // A reload or chat switch releases this chat's single-flight save.
      if (savingForRef.current === chatId) savingForRef.current = null;
    };
  }, [chatId, chatKey]);

  const loaded = setup?.key === chatKey ? setup : null;
  const writeRecord = writes?.key === chatKey ? writes : null;
  const stagedRecord = staged?.key === chatKey ? staged : null;
  const status = loadStatus(chatId, loaded);
  const effective =
    status === "error"
      ? null
      : (stagedRecord?.selection ??
        loaded?.selection ??
        accountDefault ??
        catalog?.defaultSelection ??
        null);
  const entry = catalog?.models.find((model) => model.model === effective?.model) ?? null;
  const needsChoice = stagedRecord?.needsChoice ?? false;

  /** A completion may only touch the record that still belongs to this write. */
  const patchWrite = useCallback((key: string, next: Partial<WriteRecord>) => {
    setWrites((current) => (current?.key === key ? { ...current, ...next } : current));
  }, []);

  const write = useCallback(
    (requested: ChatSelection, successNotice: string | null) => {
      if (!chatId || savingForRef.current === chatId) return;
      const key = chatKey;
      if (!loaded || loaded.error || !loaded.selection) {
        setWrites({
          key,
          saving: false,
          error: "This chat's model settings have not loaded yet. Retry loading them.",
          notice: null,
        });
        return;
      }
      const previous = loaded;
      savingForRef.current = chatId;
      setWrites({ key, saving: true, error: null, notice: null });
      setSetup((current) =>
        current?.key === key ? { ...current, selection: requested } : current,
      );
      void runPreferenceWrite({
        chatId,
        key,
        previous,
        requested,
        successNotice,
        mounted: () => mountedRef.current,
        setSetup,
        patchWrite,
        setAccountDefault,
      }).finally(() => {
        if (savingForRef.current === chatId) savingForRef.current = null;
      });
    },
    [chatId, chatKey, loaded, patchWrite, setAccountDefault],
  );

  const selectModel = useCallback(
    (model: string) => {
      const next = catalog?.models.find((item) => item.model === model);
      if (!next || !effective) return;
      if (next.availability !== "enabled") {
        setWrites({
          key: chatKey,
          saving: false,
          error: null,
          notice: `${next.name} is not enabled in this stage; no change was made.`,
        });
        return;
      }
      const plan = planModelChoice(loaded?.efforts ?? [], next, effective.effort);
      if (plan.kind === "stage") {
        setStaged({
          key: chatKey,
          selection: { provider: "cloudflare", model, effort: plan.effort },
          needsChoice: true,
        });
        setWrites({ key: chatKey, saving: false, error: null, notice: plan.notice });
        return;
      }
      setStaged(null);
      write({ provider: "cloudflare", model, effort: plan.effort }, plan.notice || null);
    },
    [catalog, chatKey, effective, loaded?.efforts, write],
  );

  const selectEffort = useCallback(
    (effort: ChatSelection["effort"]) => {
      if (!effective || !entry || !entry.efforts.includes(effort)) return;
      setStaged(null);
      write({ provider: "cloudflare", model: effective.model, effort }, null);
    },
    [effective, entry, write],
  );

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  const saving = writeRecord?.saving ?? false;
  const writeError = writeRecord?.error ?? null;
  return {
    catalog,
    catalogError,
    entry,
    selection: effective,
    selectionReady: Boolean(
      effective &&
      entry &&
      entry.availability === "enabled" &&
      status === "ready" &&
      entry.efforts.includes(effective.effort) &&
      !needsChoice &&
      !saving &&
      writeError === null,
    ),
    status,
    // A catalog failure blocks readiness too, so the visible error and Retry
    // name it before any selection write failure.
    error: catalogError ?? writeError ?? (status === "error" ? (loaded?.error ?? null) : null),
    saving,
    notice: writeRecord?.notice ?? null,
    selectModel,
    selectEffort,
    retry,
  };
}
