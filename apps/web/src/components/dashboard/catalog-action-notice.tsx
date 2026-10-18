import { useRef } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import ErrorNotice from "./error-notice";

export default function CatalogActionNotice() {
  const store = useChatStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const error = store.catalogActionError;
  if (!error) return null;
  const dismiss = () => {
    const footer = hostRef.current?.parentElement;
    const target = Array.from(
      footer?.querySelectorAll<HTMLElement>(
        '[data-cx="chat-input"]:not(:disabled), [data-cx="chat-archive-action"]:not(:disabled)',
      ) ?? [],
    ).find((element) => element.getClientRects().length > 0);
    (target ?? footer)?.focus();
    store.reportCatalogError(null);
  };
  return (
    <div ref={hostRef} data-cx="catalog-action-notice">
      <ErrorNotice
        title={error.title}
        message={error.message}
        action={{ label: "Check chats", onClick: store.reloadList }}
        dismissLabel={error.dismissLabel}
        onDismiss={dismiss}
      />
    </div>
  );
}
