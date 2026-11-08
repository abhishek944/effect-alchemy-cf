import { ObjectStore } from "@highchat/platform";
import type * as cf from "./platform.ts";
import { ChatCatalog } from "./chat-catalog-do.ts";
import { ChatConversation } from "./chat-conversation-do.ts";
import { ChatObjectRegistry, type ChatObjectContext } from "./chat-object.ts";

/** The chat object environment: plain values, one object store and two namespaces. */
export type ChatEnvironment = Record<string, unknown>;

export interface Runtime {
  readonly env: ChatEnvironment;
  readonly objects: ChatObjectRegistry<ChatEnvironment>;
  close(): void;
}

const namespaces = (objects: ChatObjectRegistry<ChatEnvironment>) => {
  const getByName = (name: string): cf.DurableObjectStub => objects.stub(name);
  return { getByName };
};

/** Release identity for logs: a full commit sha, otherwise a local marker. */
const releaseOf = (source: Readonly<Record<string, string | undefined>>): string => {
  const revision = source.GITHUB_SHA ?? "";
  return /^[a-f0-9]{40}$/.test(revision) ? revision : `local-${Date.now().toString(36)}`;
};

/**
 * Builds the process environment once. Values are copied, never invented: an
 * absent variable stays absent so every existing runtime guard keeps working.
 * The three observability labels are derived because a local process has no
 * infrastructure stack to supply them.
 */
export const createRuntime = (input: {
  readonly storageDir: string;
  readonly source: Readonly<Record<string, string | undefined>>;
}): Runtime => {
  const env: ChatEnvironment = Object.fromEntries(
    Object.entries(input.source).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  // `Config` reads the process environment; derive the labels once so every
  // request logger has them whether or not the shell supplied them.
  const labels = {
    OBS_SERVICE: input.source.APP_NAME ?? "highchat",
    OBS_STAGE: input.source.APP_STAGE ?? "local",
    OBS_RELEASE: releaseOf(input.source),
  };
  for (const [key, value] of Object.entries(labels)) {
    if (input.source[key] === undefined) process.env[key] = value;
    env[key] = process.env[key] ?? value;
  }
  env.CHAT_FILES = new ObjectStore(`${input.storageDir}/objects`);
  const objects = new ChatObjectRegistry<ChatEnvironment>({
    root: input.storageDir,
    env,
    create: (ctx, values) => createObject(ctx, values),
  });
  env.ChatCatalog = namespaces(objects);
  env.ChatConversation = namespaces(objects);
  return { env, objects, close: () => objects.close() };
};

/**
 * One widening at the private environment boundary: the record is validated by
 * each object's own runtime guards, exactly as the previous Worker env was.
 */
const createObject = (ctx: ChatObjectContext, env: ChatEnvironment) =>
  ctx.id.name.startsWith("owner:") ? new ChatCatalog(ctx, env) : new ChatConversation(ctx, env);
