/**
 * Public attachment responses: exactly one success shape per route and a safe
 * human message beside every machine-readable failure code.
 */
import { json } from "./chat-internal.ts";
import type { ChatFilesFailure } from "./chat-files-model.ts";

/** Safe, non-diagnostic messages; the code remains the machine contract. */
export const PUBLIC_MESSAGES: Record<ChatFilesFailure, string> = {
  invalid_input: "That attachment request was not valid.",
  unsupported_type: "That file type is not supported. Attach JPEG, PNG, WebP, or UTF-8 text/code.",
  invalid_content: "The file content does not match its name or could not be read safely.",
  file_too_large: "The file is larger than the allowed limit for its type.",
  too_many_files: "Attach at most 5 files to one message.",
  message_too_large: "The attached files exceed the 20 MiB combined limit.",
  quoted_text_too_large: "The attached text exceeds the 100,000-character quoted limit.",
  attachment_conflict: "That file id was already used for different content.",
  attachment_in_use: "The file belongs to a message that is being sent and cannot be removed.",
  upload_in_progress: "That upload is still in progress. Retry the same file in a moment.",
  attachment_not_ready: "The file is not available yet or no longer exists.",
  attachment_retired: "That file was removed or expired. Attach it again to get a new file id.",
  quota_exceeded: "Your private file storage is full; accepted files cannot be removed.",
  model_image_unsupported: "The selected model does not accept images.",
  model_image_limits: "The image is larger than the selected model supports.",
  native_storage_limit:
    "These attachments are too large to send in one message with the selected model.",
  unavailable: "Private file storage is temporarily unavailable. Retry.",
};

export const publicFail = (code: ChatFilesFailure, status: number): Response =>
  json({ code, message: PUBLIC_MESSAGES[code] }, status);
