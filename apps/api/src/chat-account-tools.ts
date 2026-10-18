/**
 * The account extension installed into the conversation registry.
 *
 * One place assembles the identity tool and the single theme tool so the harness
 * contract stays explicit: `get_user_details` is a non-creating read, the theme
 * tool acts only on the frozen command of their own accepted native input, and the
 * accounting extension remains a separate installation owned by the conversation
 * host.
 */
import { defineExtension, type Extension } from "@earendil-works/pi-durable";
import type { AccountToolAccess } from "./chat-account-tool-kit.ts";
import { themeTool } from "./chat-account-theme-tool.ts";
import { userDetailsTool } from "./chat-user-details-tool.ts";

export type { AccountToolAccess };

export const accountTools = (access: AccountToolAccess): Extension =>
  defineExtension({
    name: "account-profile",
    tools: [userDetailsTool(access), themeTool(access)],
  });
