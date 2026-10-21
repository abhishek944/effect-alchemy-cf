/**
 * Pin-scoped helpers: extension installation, exact revision loading, frozen
 * content storage and unchanged-guidance inheritance. Nothing here reads the
 * latest library: callers pass the exact pin or the already-verified documents.
 * A missing or corrupt active row fails closed instead of rendering empty.
 */
import type { Registry, TaskId } from "@earendil-works/pi-durable";
import { renderActiveEntries, type SkillDocument } from "./chat-skills-document.ts";
import { createSkillActivation } from "./chat-skills-activate.ts";
import {
  SKILLS_INTEGRITY,
  SKILLS_PINNED_UNAVAILABLE,
  SKILLS_UNAVAILABLE,
  SkillRuntimeError,
} from "./chat-skills-errors.ts";
import { verifyPinnedAgainstDocuments } from "./chat-skills-verify.ts";
import { buildSkillExtension } from "./chat-skills-extension.ts";
import type { SkillLibrarySource } from "./chat-skills-library.ts";
import { loadSkillLibrary } from "./chat-skills-library.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";
import type { SkillManifest } from "./skills-model.ts";

export type SkillDocumentSet = readonly SkillDocument[];
export type SkillActivationOutcome = { readonly ok: boolean; readonly message: string };

export const loadPinnedLibrary = async <
  T extends {
    readonly name: string;
    readonly version: string;
    readonly digest: string;
    readonly text: string;
  },
>(
  source: SkillLibrarySource,
  ownerId: string,
  pin: SkillManifest,
  active: readonly T[],
  storedCatalog: string | null,
) => {
  const library = await loadSkillLibrary(source, ownerId, pin.revision);
  if (
    library.manifest.digest !== pin.digest ||
    library.manifest.ownerScope !== source.catalog.id.toString()
  )
    throw new SkillRuntimeError("integrity", SKILLS_INTEGRITY);
  const kept = inheritedActive(library.documents, active);
  if (kept.length !== active.length) throw new SkillRuntimeError("integrity", SKILLS_INTEGRITY);
  const catalog = await verifyPinnedAgainstDocuments(
    library.documents,
    kept,
    pin.digest,
    storedCatalog,
  );
  return { library, active: kept, catalog };
};

/** Installs the prepared extension under the conversation admission owner. */
export const installSkillExtension = async (input: {
  readonly store: ChatSkillsStore;
  readonly registry: Registry | null;
  readonly attemptId: string;
  readonly documents: SkillDocumentSet;
  readonly catalog: string;
  readonly fingerprint: string;
  readonly activate: (
    name: string,
    formatted: string,
    taskId: TaskId | undefined,
  ) => Promise<SkillActivationOutcome>;
}): Promise<void> => {
  if (input.registry === null) throw new SkillRuntimeError("unavailable", SKILLS_UNAVAILABLE);
  const { store, attemptId } = input;
  const extension = await buildSkillExtension({
    documents: input.documents,
    fingerprint: input.fingerprint,
    catalog: input.catalog,
    activeText: () => {
      const row = store.byId(attemptId);
      if (row === null || row.corrupt)
        throw new SkillRuntimeError("unavailable", SKILLS_PINNED_UNAVAILABLE);
      return renderActiveEntries(row.active);
    },
    activate: input.activate,
  });
  input.registry.install(extension);
};

export const inheritedActive = <
  T extends {
    readonly name: string;
    readonly version: string;
    readonly digest: string;
    readonly text: string;
  },
>(
  documents: SkillDocumentSet,
  active: readonly T[],
): readonly T[] =>
  active.filter((entry) =>
    documents.some(
      (document) =>
        document.name === entry.name &&
        document.version === entry.version &&
        document.digest === entry.digest,
    ),
  );
export const installAttemptExtension = async (input: {
  readonly store: ChatSkillsStore;
  readonly registry: Registry | null;
  readonly attemptId: string;
  readonly documents: SkillDocumentSet;
  readonly catalog: string;
  readonly fingerprint: string;
  readonly defect: (
    message: string,
    taskId: TaskId | undefined,
    permanent?: boolean,
  ) => Promise<void>;
  readonly notify: () => void;
}): Promise<void> => {
  await installSkillExtension({
    store: input.store,
    registry: input.registry,
    attemptId: input.attemptId,
    documents: input.documents,
    catalog: input.catalog,
    fingerprint: input.fingerprint,
    activate: createSkillActivation({
      store: input.store,
      attemptId: input.attemptId,
      documents: input.documents,
      defect: input.defect,
      notify: input.notify,
    }),
  });
};

export const reinstallAttemptExtension = async (input: {
  readonly store: ChatSkillsStore;
  readonly source: SkillLibrarySource;
  readonly registry: Registry | null;
  readonly attemptId: string;
  readonly ownerId: string;
  readonly defect: (
    message: string,
    taskId: TaskId | undefined,
    permanent?: boolean,
  ) => Promise<void>;
  readonly notify: () => void;
}): Promise<void> => {
  const row = input.store.byId(input.attemptId);
  if (row === null || row.corrupt || row.pin === null || row.classification === "legacy")
    throw new SkillRuntimeError("invalid", "This attempt has no restorable pin.");
  const loaded = await loadPinnedLibrary(
    input.source,
    input.ownerId,
    row.pin,
    row.active,
    row.catalog,
  );
  await installAttemptExtension({
    store: input.store,
    registry: input.registry,
    attemptId: input.attemptId,
    documents: loaded.library.documents,
    catalog: loaded.catalog,
    fingerprint: row.pin.digest,
    defect: input.defect,
    notify: input.notify,
  });
};
