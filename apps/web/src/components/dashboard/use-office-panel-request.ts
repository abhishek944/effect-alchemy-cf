import { useEffect, useEffectEvent } from "react";
import type { Target } from "@starter/office-contract";
import { useChatStore } from "@/lib/chat-store-context";
import { useWorkspacePreview } from "./workspace-preview-context";

/**
 * Consumes fresh tool requests for every retained chat. The request always opens in the chat that
 * owns it; only that chat's visible workspace reveals or focuses anything, so a hidden running chat
 * can finish its Office work without taking focus from the conversation on screen.
 */
export function OfficePanelRequests({ active }: { active: boolean }) {
  const { panelRequests, claimPanelRequest } = useChatStore();
  const preview = useWorkspacePreview();
  const open = useEffectEvent((chatId: string, requestId: string, target: Target) => {
    // Consume before opening: a refused allocation is still handled once, never retried per render.
    claimPanelRequest(chatId, requestId);
    // The preview provider reveals only when this exact chat is the one on screen.
    preview.openOfficeIn(
      chatId,
      { title: "Office document", target, reviewId: null, attachments: [] },
      true,
    );
  });
  useEffect(() => {
    // Every request is consumed exactly once, even while another section is showing; only a
    // visible, still-fresh request opens a panel, matching the old first-observation rule.
    for (const { chatId, request } of panelRequests) {
      if (!active || request.expiresAt <= Date.now()) claimPanelRequest(chatId, request.id);
      else open(chatId, request.id, request.target);
    }
  }, [active, claimPanelRequest, panelRequests]);
  return null;
}
