import type { PreviewView } from "./workspace-preview-model";

/** Every visited chat keeps its own tab hierarchy; the selected one is projected to the UI. */
export type WorkspaceViews = Record<string, PreviewView>;

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

/** Stable list for rendering; identity changes only when a retained view changed. */
export const viewEntries = (views: WorkspaceViews): readonly [string, PreviewView][] =>
  Object.entries(views);
