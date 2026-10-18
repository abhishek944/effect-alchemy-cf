/** Catalog and account default loading for the model/effort selectors. */
import { useEffect, useState } from "react";
import {
  capabilityMessage,
  getAccountChatPreferences,
  getChatCatalog,
} from "@/lib/chat-capability-api";
import type { ChatCatalog, ChatSelection } from "@/lib/chat-capability-types";

type CatalogRecord = { key: string; catalog: ChatCatalog | null; error: string | null };

export function useChatCatalogDefaults(reloadKey: number) {
  const [record, setRecord] = useState<CatalogRecord | null>(null);
  const [accountDefault, setAccountDefault] = useState<ChatSelection | null>(null);
  const key = `catalog|${reloadKey}`;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const loadCatalog = async () => {
      try {
        const catalog = await getChatCatalog(controller.signal);
        if (active) setRecord({ key, catalog, error: null });
      } catch (cause) {
        if (active && !controller.signal.aborted)
          setRecord({
            key,
            catalog: null,
            error: capabilityMessage(cause, "Loading chat capabilities"),
          });
      }
    };
    const loadAccount = async () => {
      try {
        const view = await getAccountChatPreferences();
        if (active) setAccountDefault(view.preferences.defaultSelection);
      } catch {
        // The catalog default still applies; no invented account state.
      }
    };
    void loadCatalog();
    void loadAccount();
    return () => {
      active = false;
      controller.abort();
    };
  }, [key]);

  return {
    catalog: record?.key === key ? record.catalog : null,
    catalogError: record?.key === key ? record.error : null,
    accountDefault,
    setAccountDefault,
  };
}
