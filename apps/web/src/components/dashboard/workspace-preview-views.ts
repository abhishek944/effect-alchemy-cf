import type { PreviewView, WorkspacePreviewTab } from "./workspace-preview-model";

/** Every visited chat keeps its own tab hierarchy; the selected one is projected to the UI. */
export type WorkspaceViews = Record<string, PreviewView>;

export const MAX_NATIVE_SURFACES = 8;
export const NATIVE_LIMIT =
  "Close a saved native tab before opening another; eight native surfaces are the browser limit.";
/** Committed native editors only; a restored descriptor is a placeholder, not a surface. */
const isNative = (tab: WorkspacePreviewTab): boolean =>
  tab.kind === "office" || tab.kind === "office-file";

/** One account-wide native-surface budget, so retained hidden workspaces cannot multiply it. */
export const nativeSurfaceCount = (views: WorkspaceViews): number =>
  Object.values(views).reduce((sum, view) => sum + view.tabs.filter(isNative).length, 0);

export const updateView = (
  views: WorkspaceViews,
  chatId: string,
  update: (view: PreviewView) => PreviewView,
): WorkspaceViews => {
  const view = views[chatId];
  if (view === undefined) return views;
  const next = update(view);
  return next === view ? views : { ...views, [chatId]: next };
};

/**
 * Applies an open only when it keeps committed native surfaces within the aggregate budget.
 * Running this inside the state updater makes bursts (for example several AI panel requests in one
 * effect) see the accumulated state instead of a stale render closure. Activation of an already
 * open tab never adds a surface and is always allowed.
 */
export const openWithinCapacity = (
  views: WorkspaceViews,
  chatId: string,
  apply: (view: PreviewView) => PreviewView,
  reserved = 0,
): WorkspaceViews => {
  const view = views[chatId];
  if (view === undefined) return views;
  const next = apply(view);
  if (next === view) return views;
  const before = nativeSurfaceCount(views);
  const after = nativeSurfaceCount({ ...views, [chatId]: next });
  if (after > before && after + reserved > MAX_NATIVE_SURFACES) return views;
  return { ...views, [chatId]: next };
};

/** Stable list for rendering; identity changes only when a retained view changed. */
export const viewEntries = (views: WorkspaceViews): readonly [string, PreviewView][] =>
  Object.entries(views);
