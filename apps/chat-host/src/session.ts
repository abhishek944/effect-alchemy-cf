import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { RunChannel } from "./channel.ts";
import { openRemoteModel } from "./model.ts";
import { toolExtension } from "./tools.ts";

/**
 * A run owns no local resources: no builtin tools, no discovered extensions,
 * skills, prompts, themes, context files, settings or credentials. Only the
 * Worker's declared tools load, and the model is the Worker-transported one.
 */
const sandbox = join(tmpdir(), "highchat-chat-host-absent");

export interface OpenedSession {
  readonly session: AgentSession;
}

export const openSession = async (channel: RunChannel): Promise<OpenedSession> => {
  const { request } = channel;
  const settings = SettingsManager.inMemory({
    retry: { enabled: false },
    images: { autoResize: false },
    cacheWarming: "off",
  });
  const sessions = SessionManager.inMemory(sandbox);
  for (const message of request.history) sessions.appendMessage(message);
  const { runtime, model } = await openRemoteModel(channel);
  const loader = new DefaultResourceLoader({
    cwd: sandbox,
    agentDir: sandbox,
    settingsManager: settings,
    extensionFactories: [toolExtension(channel)],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: request.systemPrompt,
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: sandbox,
    agentDir: sandbox,
    modelRuntime: runtime,
    model,
    thinkingLevel: request.selection.effort,
    sessionManager: sessions,
    settingsManager: settings,
    resourceLoader: loader,
    noTools: "builtin",
    tools: request.tools.map((tool) => tool.name),
  });
  return { session };
};
