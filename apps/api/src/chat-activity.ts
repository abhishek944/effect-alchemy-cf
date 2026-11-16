import { ConversationActivity } from "@highchat/chat-contract/gateway-usage";
import { Schema } from "effect";
import type { ChatSqlStorage } from "./chat-ledger.ts";

/** Timestamp-only projection: no transcript content, operation IDs or chat IDs leave storage. */
export const conversationActivity = (
  db: ChatSqlStorage,
  period: { readonly start: string; readonly end: string },
): typeof ConversationActivity.Type => {
  const rows = db
    .exec<{ day: string | null }>(
      `WITH days AS (
      SELECT CASE WHEN json_type(m.value, '$.timestamp') IN ('integer', 'real')
        THEN date(json_extract(m.value, '$.timestamp') / 1000.0, 'unixepoch') END AS day
      FROM chat_sdk_entries e LEFT JOIN json_each(e.record, '$.model') m
        ON json_extract(m.value, '$.role') = 'user'
      WHERE json_extract(e.record, '$.kind') = 'pi.user'
    )
    SELECT DISTINCT day FROM days
    WHERE day IS NULL OR (day >= ? AND day <= ?) ORDER BY day`,
      period.start,
      period.end,
    )
    .toArray();
  // Missing/invalid user timestamps cannot silently become zero activity.
  return Schema.decodeUnknownSync(ConversationActivity)({ days: rows.map((row) => row.day) });
};
