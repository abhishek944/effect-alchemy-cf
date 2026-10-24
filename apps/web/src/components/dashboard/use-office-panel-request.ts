import { useEffect, useEffectEvent, useRef } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import { useWorkspacePreview } from "./workspace-preview-context";

/** Consume fresh tool requests only; initial/reloaded snapshots never reopen old tool intent. */
export function OfficePanelRequests({ active }: { active: boolean }) {
  const { selectedId, snapshot, attachment } = useChatStore();
  const preview = useWorkspacePreview();
  const seen = useRef<{ scope: string; id: string | null } | null>(null);
  const scope = `${selectedId}/${attachment}`;
  const request = snapshot?.chat.id === selectedId ? snapshot.panelRequest : null;
  const open = useEffectEvent(() => {
    if (!request) return;
    preview.openOffice({ title: "Office document", target: request.target, reviewId: null });
  });
  useEffect(() => {
    if (snapshot?.chat.id !== selectedId) return;
    if (seen.current?.scope !== scope) {
      seen.current = { scope, id: request?.id ?? null };
      return;
    }
    if (!request || seen.current.id === request.id) return;
    seen.current.id = request.id;
    if (active && request.expiresAt > Date.now()) open();
  }, [scope, selectedId, snapshot?.chat.id, request, active]);
  return null;
}
