import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { RunChannel } from "./channel.ts";

/**
 * Registers the Worker's tool declarations as real Pi extension tools. The SDK
 * validates arguments against the declared JSON Schema before `execute` runs, and
 * `execute` forwards the call over the run's reply channel.
 */
export const toolExtension =
  (channel: RunChannel): ExtensionFactory =>
  (pi) => {
    for (const declaration of channel.request.tools) {
      pi.registerTool({
        name: declaration.name,
        label: declaration.label,
        description: declaration.description,
        parameters: declaration.parameters,
        execute: async (toolCallId, params, signal) => {
          const reply = await channel.executeTool(
            { toolCallId, toolName: declaration.name, input: params },
            signal,
          );
          return {
            content: reply.content,
            details: reply.details,
            ...(reply.isError === true ? { isError: true } : {}),
          };
        },
      });
    }
  };
