import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createEmptyHistoryState } from "@lexical/history";
import {
  freezeOfficeSendTarget,
  type ChatReferenceInputs,
  type OfficeSendTarget,
} from "@starter/office-contract";
import type { LexicalEditor } from "lexical";
import type {
  ReferenceEditorBinding,
  ReferenceObservation,
  ReferenceSource,
} from "./reference-types";
import { prepareReference } from "./reference-admission";
import { freezeReferenceObservation } from "./reference-observation";
import { nativeReferenceKey, originalReferenceKey } from "./reference-types";

type Session = {
  editor: LexicalEditor | null;
  history: ReturnType<typeof createEmptyHistoryState>;
  caret: { current: { start: number; end: number } | null };
  submitted: { operationId: string; text: string; inputs: ChatReferenceInputs } | null;
};
type Entry = { observation: ReferenceObservation; closed: boolean };
type Workspace = {
  registerSource: (source: ReferenceSource) => () => void;
  sources: (chatId: string) => readonly ReferenceSource[];
  source: (chatId: string, key: string) => ReferenceSource | null;
  observe: (observation: ReferenceObservation) => void;
  observations: (chatId: string) => readonly ReferenceObservation[];
  close: (observation: ReferenceObservation) => void;
  sendTarget: (chatId: string, target: OfficeSendTarget) => OfficeSendTarget;
  add: (
    source: ReferenceSource,
    observation?: ReferenceObservation | null,
    replace?: { start: number; end: number },
  ) => Promise<void>;
  view: (observation: ReferenceObservation) => Promise<void>;
  bindEditor: (chatId: string, editor: ReferenceEditorBinding) => () => void;
  editor: (chatId: string) => ReferenceEditorBinding | null;
  session: (chatId: string) => Session;
  recordSend: (chatId: string, submitted: Session["submitted"]) => void;
};
const Context = createContext<Workspace | null>(null);
const scopeKey = (chatId: string, key: string) => JSON.stringify([chatId, key]);
const selectSource = (rows: readonly ReferenceSource[] | undefined, viewId?: string) =>
  (viewId
    ? rows?.find((source) => source.kind === "native" && source.target.viewId === viewId)
    : rows?.at(-1)) ?? null;

/** Mount once inside the account boundary, above ChatStoreProvider and preview/native siblings. */
export function ReferenceWorkspaceProvider({ children }: { children: ReactNode }) {
  const sources = useRef(new Map<string, readonly ReferenceSource[]>());
  const entries = useRef(new Map<string, Entry>());
  const editors = useRef(new Map<string, ReferenceEditorBinding>());
  const sessions = useRef(new Map<string, Session>());
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((value) => value + 1), []);
  const value = useMemo<Workspace>(
    () => ({
      registerSource(source) {
        const canonical =
          source.kind === "native"
            ? nativeReferenceKey(source.target)
            : originalReferenceKey(source.file.id);
        if (source.key !== canonical)
          throw new Error("Use the canonical reference source key to avoid duplicate aliases.");
        const key = scopeKey(source.chatId, source.key);
        sources.current.set(key, [...(sources.current.get(key) ?? []), source]);
        changed();
        return () => {
          const remaining =
            sources.current.get(key)?.filter((candidate) => candidate !== source) ?? [];
          if (remaining.length) sources.current.set(key, remaining);
          else sources.current.delete(key);
          changed();
        };
      },
      sources: (chatId) =>
        [...sources.current.values()].flatMap((rows) => {
          const source = selectSource(rows);
          return source?.chatId === chatId ? [source] : [];
        }),
      source: (chatId, key) => selectSource(sources.current.get(scopeKey(chatId, key))),
      observe(observation) {
        const key = scopeKey(observation.chatId, observation.sourceKey);
        if (entries.current.get(key)?.observation.captureId === observation.captureId) return;
        // Capture DTOs have no SDK resources; clone so later callbacks cannot mutate prior intent.
        entries.current.set(key, {
          observation: freezeReferenceObservation(
            observation,
            selectSource(
              sources.current.get(key),
              observation.kind === "native" ? observation.capture.viewId : undefined,
            ) ?? undefined,
          ),
          closed: false,
        });
        changed();
      },
      observations: (chatId) =>
        [...entries.current.values()]
          .filter((entry) => !entry.closed && entry.observation.chatId === chatId)
          .map((entry) => entry.observation),
      close(observation) {
        const entry = entries.current.get(scopeKey(observation.chatId, observation.sourceKey));
        if (entry?.observation.captureId !== observation.captureId) return;
        entries.current.set(scopeKey(observation.chatId, observation.sourceKey), {
          ...entry,
          closed: true,
        });
        changed();
      },
      sendTarget(chatId, target) {
        const entry = entries.current.get(scopeKey(chatId, nativeReferenceKey(target)));
        if (!entry?.closed || !target.context?.sheet) return target;
        const { context, ...identity } = target;
        return freezeOfficeSendTarget({
          ...identity,
          ...(context.attachmentIds ? { context: { attachmentIds: context.attachmentIds } } : {}),
        });
      },
      async add(source, observation = null, replace) {
        const binding = editors.current.get(source.chatId);
        if (!binding) throw new Error("Open this chat's composer before adding a reference.");
        const insert = binding.remember(replace);
        const frozenObservation = observation
          ? freezeReferenceObservation(observation, source)
          : null;
        const owning =
          source.kind === "native"
            ? selectSource(
                sources.current.get(scopeKey(source.chatId, source.key)),
                observation?.kind === "native" ? observation.capture.viewId : source.target.viewId,
              )
            : source;
        if (!owning)
          throw new Error("The exact source frame is unavailable. Reopen it and reselect.");
        const prepared = await prepareReference(owning, frozenObservation);
        if (editors.current.get(source.chatId) !== binding)
          throw new Error(
            "The composer changed before the reference was ready. Your draft is kept.",
          );
        insert(prepared);
      },
      async view(observation) {
        const source = selectSource(
          sources.current.get(scopeKey(observation.chatId, observation.sourceKey)),
          observation.kind === "native" ? observation.capture.viewId : undefined,
        );
        if (!source || source.kind !== observation.kind)
          throw new Error("This source is no longer available. Reopen it to view the selection.");
        if (source.kind === "native" && observation.kind === "native")
          await source.reveal(observation.capture);
        else if (source.kind === "original" && observation.kind === "original")
          await source.reveal(observation.capture);
      },
      bindEditor(chatId, editor) {
        editors.current.set(chatId, editor);
        return () => {
          if (editors.current.get(chatId) === editor) editors.current.delete(chatId);
        };
      },
      editor: (chatId) => editors.current.get(chatId) ?? null,
      recordSend(chatId, submitted) {
        const session = sessions.current.get(chatId);
        if (session) session.submitted = submitted;
      },
      session(chatId) {
        let session = sessions.current.get(chatId);
        if (!session) {
          session = {
            editor: null,
            history: createEmptyHistoryState(),
            caret: { current: null },
            submitted: null,
          };
          sessions.current.set(chatId, session);
        }
        return session;
      },
    }),
    [changed],
  );
  const published = useMemo(() => ({ ...value, version }), [value, version]);
  return <Context.Provider value={published}>{children}</Context.Provider>;
}
export function useReferenceWorkspace(): Workspace {
  const value = useContext(Context);
  if (!value) throw new Error("References require the account-scoped ReferenceWorkspaceProvider.");
  return value;
}
