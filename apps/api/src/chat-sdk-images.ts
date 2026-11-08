/**
 * Worker-side `image_generate` descriptor for the real Node SDK host.
 *
 * The host registers this exact tool for the run. Execution stays in the Worker:
 * it proves the accepted operation and assistant tool call, freezes account
 * image preferences, authorizes same-chat saved originals, runs one portable
 * engine dispatch on the actual binding and returns compact private links.
 */
import { Type } from "@earendil-works/pi-ai";
import type { ChatSdkImagesDeps } from "./chat-sdk-files-types.ts";
import type { ChatSdkImages } from "./chat-sdk-files-types.ts";
import { runImageTool } from "./chat-sdk-images-call.ts";
import type { ChatSdkTool } from "./chat-sdk-tool.ts";

const parameters = Type.Object(
  {
    prompt: Type.String({ minLength: 1, maxLength: 32_000 }),
    image: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 8192 }), {
        minItems: 1,
        maxItems: 16,
      }),
    ),
    size: Type.Optional(
      Type.Union(
        ["auto", "1024x1024", "1024x1536", "1536x1024"].map((value) => Type.Literal(value)),
      ),
    ),
    quality: Type.Optional(
      Type.Union(
        ["auto", "low", "medium", "high", "xhigh", "max"].map((value) => Type.Literal(value)),
      ),
    ),
  },
  { additionalProperties: false },
);

export const imageGenerateTool = (deps: ChatSdkImagesDeps): ChatSdkTool => ({
  name: "image_generate",
  description:
    "Generate one image, or edit using ordered original image URLs from this chat. " +
    "Omitted controls use the response-frozen account preferences. Never choose a provider, path or credential. " +
    "Use independent native calls for multiple requested images. After a dispatched or uncertain failure, " +
    "do not repeat generation without a new explicit user request; retain already-saved images.",
  parameters,
  execute: (input, scope) => runImageTool(deps, input, scope),
});

export const createChatSdkImages = (deps: ChatSdkImagesDeps): ChatSdkImages => ({
  descriptors: [imageGenerateTool(deps)],
});
