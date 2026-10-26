import { Schema } from "effect";
import { Id, Target } from "@starter/office-contract";
import { isUuid } from "@/lib/chat-validate-base";
import type { PreviewView, WorkspacePreviewTab } from "./workspace-preview-model";

const ChatId = Schema.String.check(Schema.makeFilter(isUuid));
const TabId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,512}$/));
const Simple = Schema.Struct({ id: TabId, kind: Schema.Literals(["tools", "files"]) });
const File = Schema.Struct({
  id: TabId,
  kind: Schema.Literals(["image", "text", "office-file"]),
  fileId: ChatId,
});
const Native = Schema.Struct({
  id: TabId,
  kind: Schema.Literal("office"),
  target: Target,
  reviewId: Schema.NullOr(Id),
  attachments: Schema.Array(ChatId).check(Schema.isMaxLength(100)),
});
export const TabDescriptor = Schema.Union([Simple, File, Native]);
export type TabDescriptor = typeof TabDescriptor.Type;
export const PaneDescriptor = Schema.Struct({
  sidebar: Schema.Boolean,
  right: Schema.Boolean,
  full: Schema.Boolean,
  restoreRight: Schema.Boolean,
});
export type PaneDescriptor = typeof PaneDescriptor.Type;
const Layout = Schema.Struct({
  version: Schema.Literal(1),
  chatId: ChatId,
  tabs: Schema.Array(TabDescriptor).check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  activeId: TabId,
  panes: Schema.optional(PaneDescriptor),
});
type Layout = typeof Layout.Type;
const prefix = (accountId: string) => `workspace-layout:v1:${encodeURIComponent(accountId)}`;
const layoutKey = (accountId: string, chatId: string) => `${prefix(accountId)}:chat:${chatId}`;
const read = (key: string): unknown => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null || raw.length > 131072 ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage is optional. */
  }
};
export function rememberedChat(accountId: string): string | null {
  const value = read(`${prefix(accountId)}:selection`);
  return typeof value === "string" && isUuid(value) ? value : null;
}
export function rememberChat(accountId: string, chatId: string | null) {
  write(`${prefix(accountId)}:selection`, chatId);
}
export function readLayout(accountId: string, chatId: string | null): Layout | null {
  if (chatId === null || !isUuid(chatId)) return null;
  try {
    const value = Schema.decodeUnknownSync(Layout, { onExcessProperty: "error" })(
      read(layoutKey(accountId, chatId)),
    );
    if (
      value.chatId !== chatId ||
      !value.tabs.some((tab) => tab.id === value.activeId) ||
      new Set(value.tabs.map((tab) => tab.id)).size !== value.tabs.length ||
      value.tabs.filter((tab) => tab.kind === "office" || tab.kind === "office-file").length > 8
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function describeTab(tab: WorkspacePreviewTab): TabDescriptor {
  if (tab.kind === "restoring") return tab.descriptor;
  if (tab.kind === "tools" || tab.kind === "files") return { id: tab.id, kind: tab.kind };
  const selection =
    tab.kind === "office" ? tab.selection : tab.kind === "office-file" ? tab.resolved : null;
  if (selection !== null)
    return {
      id: tab.id,
      kind: "office",
      target: selection.target,
      reviewId: selection.reviewId,
      attachments: [
        ...new Set([
          ...selection.attachments,
          ...(tab.kind === "office-file" ? [tab.file.id] : []),
        ]),
      ],
    };
  if ("file" in tab) return { id: tab.id, kind: tab.kind, fileId: tab.file.id };
  throw new Error("Office selection is unavailable.");
}
export function restorePreview(accountId: string, chatId: string | null): PreviewView | null {
  const layout = readLayout(accountId, chatId);
  if (layout === null) return null;
  return {
    chatId,
    activeId: layout.activeId,
    focus: { sequence: 0, target: "tab" },
    tabs: layout.tabs.map((descriptor): WorkspacePreviewTab =>
      descriptor.kind === "tools" || descriptor.kind === "files"
        ? descriptor
        : { id: descriptor.id, kind: "restoring", descriptor },
    ),
  };
}
export function storePreview(accountId: string, view: PreviewView) {
  if (view.chatId === null) return;
  const prior = readLayout(accountId, view.chatId);
  const value = {
    version: 1,
    chatId: view.chatId,
    tabs: view.tabs.map(describeTab),
    activeId: view.activeId,
    ...(prior?.panes === undefined ? {} : { panes: prior.panes }),
  };
  try {
    Schema.decodeUnknownSync(Layout, { onExcessProperty: "error" })(value);
    write(layoutKey(accountId, view.chatId), value);
  } catch {
    /* Invalid/oversized descriptors are never storage authority. */
  }
}
export function storePanes(accountId: string, chatId: string | null, panes: PaneDescriptor) {
  const prior = readLayout(accountId, chatId);
  if (prior !== null && chatId !== null) write(layoutKey(accountId, chatId), { ...prior, panes });
}
