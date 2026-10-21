import type { ChatAdmission } from "./chat-admission.ts";
import type { ChatCatalogData } from "./chat-catalog-data.ts";
import { resolveChatSelectionValue, type StageModelPolicy } from "./chat-capability-policy.ts";
import type { ChatTitles } from "./chat-title-store.ts";
import {
  CatalogAdmitBody,
  CatalogOperationBody,
  CatalogReleaseBody,
  CatalogTitleClaimBody,
  decodeOption,
  digestText,
  json,
  requestBody,
} from "./chat-internal.ts";

/** Existing paid-chat/title admission routes, kept separate from actor composition. */
export async function catalogAdmissionRequest(
  request: Request,
  deps: {
    admission: ChatAdmission;
    data: ChatCatalogData;
    titles: ChatTitles;
    policy: StageModelPolicy;
  },
): Promise<Response> {
  const route = `${request.method} ${new URL(request.url).pathname}`;
  switch (route) {
    case "POST /title/claim": {
      const body = decodeOption(CatalogTitleClaimBody, await requestBody(request));
      if (body === null) return json({ message: "Invalid request" }, 400);
      if (!resolveChatSelectionValue(deps.policy, body.selection).ok)
        return json({ claimed: false });
      const claimed = await deps.titles.claim(
        body.operationId,
        body.id,
        body.text,
        body.identity,
        body.selection,
      );
      return json({ claimed });
    }
    case "POST /admit": {
      const body = decodeOption(CatalogAdmitBody, await requestBody(request));
      if (body === null) return json({ message: "Invalid request" }, 400);
      const textHash = await digestText(body.identity);
      // No await between authoritative archive read and synchronous admission.
      const chat = deps.data.find(body.chatId);
      if (chat === null) return json({ message: "Not found" }, 404);
      if (chat.archived)
        return json({ admitted: false, duplicate: false, reason: "archived", attemptId: null });
      return json(
        deps.admission.admit(
          body.operationId,
          body.chatId,
          textHash,
          body.now,
          body.nativeAccepted,
          body.attemptId,
        ),
      );
    }
    case "POST /finalize": {
      const body = decodeOption(CatalogOperationBody, await requestBody(request));
      if (body === null) return json({ message: "Invalid request" }, 400);
      deps.admission.finalize(body.operationId, body.now);
      return json({ ok: true });
    }
    case "POST /release": {
      const body = decodeOption(CatalogReleaseBody, await requestBody(request));
      if (body === null) return json({ message: "Invalid request" }, 400);
      deps.admission.release(body.operationId, body.attemptId);
      return json({ ok: true });
    }
    default:
      return json({ message: "Not found" }, 404);
  }
}
