import { useAuiState } from "@assistant-ui/react";
import { ImageUsageDetails } from "./image-usage-details";

/** The existing message facts popover already owns the exact assistant-ui message context. */
export function ImageUsageResponse({ pending }: { pending: boolean }) {
  const messageId = useAuiState((state) => state.message.id);
  return <ImageUsageDetails messageId={messageId} pending={pending} />;
}
