/**
 * Conversation-object assembly for the skills runtime.
 *
 * These helpers keep the Durable Object class small: the owner-scoped library
 * seam, the durable recovery projection, the guarded harness factory and the
 * authenticated internal endpoint dispatch. No browser or model argument can
 * choose the owner scope.
 */
import type { Registry, Storage } from "@earendil-works/pi-durable";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai/models";
import { makeOfficeExtension, type OfficePiHost } from "@starter/office-pi";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import type { PiHarnessFactory } from "agents/harness/pi";
import type { ChatAccounting } from "./chat-accounting.ts";
import { accountTools } from "./chat-account-tools.ts";
import { accountToolAccess, type AccountPreparationDeps } from "./chat-account-preparation.ts";
import type { Chat } from "./chat-model.ts";
import type { ChatRuntime } from "./chat-runtime.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";
import type { ChatSendScope } from "./chat-submission.ts";
import type { ChatSelection } from "./chat-capabilities.ts";
import { SKILLS_INCOMPLETE } from "./chat-skills-errors.ts";
import { installSkillModelsGuard } from "./chat-skills-guard.ts";
import { ChatSkillsRecovery } from "./chat-skills-recovery.ts";
import type { ChatSkillsRecoveryDeps } from "./chat-skills-recovery.ts";
import { ConversationSkills } from "./chat-skills-runtime.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";
import type { ChatOwnerBinding } from "./chat-tool-authorization.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import { decodeOption, json, requestBody } from "./chat-internal.ts";
import { conversationApplicationOrigin } from "./chat-public-origin.ts";
import type { ConversationImages } from "./chat-image-runtime.ts";
import { SkillNewSendRequest, SkillRetryRequest, type SkillRecovery } from "./skills-model.ts";

/** Owner-scoped private library seam; never a browser or model argument. */
export const conversationSkillSource = (env: ConversationFileEnv, owners: ChatOwnerBinding) => {
  const catalog = env.ChatCatalog;
  const owner = owners.owner();
  if (catalog === undefined || owner === null) return null;
  return { catalog: catalog.getByName(`owner:${owner}`), bucket: env.CHAT_FILES ?? null };
};

/** Per-entry attempt provenance for bounded history projection. */
export const skillAttemptProvenance = (
  store: ChatSkillsStore,
  operationId: string,
): { readonly logicalOperationId: string; readonly incomplete: boolean } | null => {
  const row = store.byOperation(operationId);
  // Corrupt guidance must not erase a known attempt/incomplete attribution;
  // only a positively classified legacy row has no attempt to attribute.
  if (row === null || row.classification === "legacy") return null;
  return {
    logicalOperationId: row.logicalOperationId,
    incomplete: row.status === "incomplete" || row.status === "unavailable",
  };
};

/** Durable recovery projection; null unless the newest pinned operation failed. */
export const skillRecoveryView = (store: ChatSkillsStore): SkillRecovery | null => {
  const latest = store.latestFailure();
  if (latest === null) return null;
  const message = latest.failure ?? SKILLS_INCOMPLETE;
  return {
    logicalOperationId: latest.logicalOperationId,
    failedAttemptId: latest.operationId,
    canRetry: !latest.corrupt && latest.pin !== null && latest.recoverable !== false,
    message: (latest.failure ?? latest.recoveryReason ?? message).slice(0, 256),
  };
};

export const createConversationSkills = (input: {
  readonly store: ChatSkillsStore;
  readonly env: ConversationFileEnv;
  readonly owners: ChatOwnerBinding;
  readonly records: ChatSendRecords;
  readonly registry: () => Registry | null;
  readonly runtime: () => ChatRuntime;
  readonly notify: () => void;
}): ConversationSkills => {
  const library = () => conversationSkillSource(input.env, input.owners);
  return new ConversationSkills({
    store: input.store,
    registry: input.registry,
    library,
    runtime: input.runtime,
    owner: () => input.owners.owner(),
    scope: () => library()?.catalog.id.toString() ?? null,
    sendEra: (operationId) => input.records.sendEra(operationId),
    logicalOperation: (operationId) => input.records.logicalOperation(operationId),
    notify: input.notify,
  });
};

export const createConversationSkillRecovery = (
  input: ChatSkillsRecoveryDeps,
): ChatSkillsRecovery => new ChatSkillsRecovery(input);

/** Guarded harness factory: accounting on the raw path, recovery before resume. */
export const conversationHarnessFactory =
  (deps: {
    readonly setProvider: (models: MutableModels) => void;
    readonly accounting: ChatAccounting;
    readonly account: AccountPreparationDeps;
    readonly skills: ConversationSkills;
    readonly images: ConversationImages;
    readonly office: OfficePiHost;
    readonly selection: () => Promise<ChatSelection | null>;
    readonly setRegistry: (registry: Registry) => void;
    readonly setStorage: (storage: Storage) => void;
  }): PiHarnessFactory =>
  async ({ storage, context }) => {
    const models = createModels();
    deps.setProvider(models);
    deps.setStorage(storage);
    const registry = createRegistry();
    deps.setRegistry(registry);
    registry.install(deps.accounting.extension(() => deps.selection()));
    registry.install(accountTools(accountToolAccess(deps.account)));
    registry.install(makeOfficeExtension(deps.office));
    const prepare = deps.images.install(storage, context, registry, deps.skills);
    installSkillModelsGuard(models, {
      observeCompactions: () => deps.accounting.observeCompactions(models),
      guard: {
        prepare,
        summary: () => deps.skills.summaryHealth(),
        capture: () => deps.skills.scopeLiveOperation(),
        failed: (message, operationId) => deps.skills.failForOperation(operationId, message),
      },
    });
    const harness = await Harness.open(storage, { models, registry }, context);
    // Raw-harness reconstruction only: re-entering PiHarness from inside its own
    // factory would self-await `_doOpen` and deadlock the open.
    await deps.images.beforeResume(harness, context, deps.skills);
    return harness;
  };

/** Both dispatch gates bound to one conversation skills owner. */
export const conversationSkillGates = (skills: ConversationSkills) => ({
  dispatchGate: (operationId: string) => skills.assertDispatchAllowed(operationId),
  dispatchFence: (operationId: string) => skills.dispatchBlocked(operationId),
});

/** Internal owner-authenticated recovery routes; null when the path is not ours. */
export const conversationSkillsEndpoint = async (input: {
  readonly request: Request;
  readonly pathname: string;
  readonly owners: ChatOwnerBinding;
  readonly chat: Chat;
  readonly recovery: ChatSkillsRecovery;
}): Promise<Response | null> => {
  const isRetry = input.pathname === "/skills/retry";
  const isReadiness = input.pathname === "/skills/readiness";
  if (!isRetry && !isReadiness && input.pathname !== "/skills/new-send") return null;
  const ownerId = input.request.headers.get("x-chat-owner");
  if (ownerId === null || ownerId.length === 0 || ownerId.length > 256)
    return json({ message: "Missing owner identity" }, 400);
  if (!input.owners.bind(ownerId, Date.now()))
    return json({ message: "Owner identity does not match this conversation." }, 400);
  // Readiness is read-only and must not parse or require a command body.
  if (isReadiness)
    return input.request.method === "GET"
      ? json(await input.recovery.readiness())
      : json({ message: "Not found" }, 404);
  const raw = await requestBody(input.request);
  const applicationOrigin = conversationApplicationOrigin(input.request);
  if (applicationOrigin === null) return json({ message: "Missing application origin" }, 400);
  const scope: ChatSendScope = { chat: input.chat, ownerId, applicationOrigin };
  if (isRetry) {
    const body = decodeOption(SkillRetryRequest, raw);
    return body === null
      ? json({ message: "Invalid request" }, 400)
      : input.recovery.retry(body, scope);
  }
  const body = decodeOption(SkillNewSendRequest, raw);
  return body === null
    ? json({ message: "Invalid request" }, 400)
    : input.recovery.newSend(body, scope);
};
