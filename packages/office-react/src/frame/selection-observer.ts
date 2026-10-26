import { DocSelectionManagerService } from "@univerjs/docs";
import type { NativeApplication } from "./native.ts";

/** Native completion events plus genuine user gestures; no DOM text/selection scraping. */
export function observeCompletedSelection(
  native: NativeApplication,
  unitId: string,
  kind: string,
  completed: () => void,
) {
  let disposed = false;
  let pointer = false;
  let keyboard = false;
  let finishing = false;
  let composing = false;
  let changed = false;
  let suppressed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners: (() => void)[] = [];
  const listen = <K extends keyof DocumentEventMap>(
    type: K,
    fn: (event: DocumentEventMap[K]) => void,
  ) => {
    document.addEventListener(type, fn, true);
    listeners.push(() => document.removeEventListener(type, fn, true));
  };
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      finishing = false;
      if (!disposed && !suppressed && !pointer && !keyboard && !composing && changed) {
        changed = false;
        completed();
      }
    }, 0);
  };
  listen("pointerdown", (event) => {
    if (!event.isTrusted || event.button !== 0) return;
    generation++;
    if (suppressed) return;
    changed = false;
    // Only the native drawing surface starts a selection gesture, never a toolbar/menu.
    pointer = event.target instanceof HTMLCanvasElement;
  });
  listen("pointerup", (event) => {
    if (!event.isTrusted || !pointer) return;
    pointer = false;
    finishing = true;
    schedule();
  });
  listen("pointercancel", () => {
    pointer = false;
    changed = false;
    generation++;
  });
  listen("keydown", (event) => {
    if (!event.isTrusted) return;
    if (suppressed) {
      generation++;
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-u-comp="editor"],canvas')) return;
    if (
      (event.shiftKey && /^(Arrow|Home|End|Page)/.test(event.key)) ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a")
    ) {
      keyboard = true;
      generation++;
    }
  });
  listen("keyup", (event) => {
    if (!event.isTrusted || !keyboard) return;
    keyboard = false;
    finishing = true;
    schedule();
  });
  listen("compositionstart", () => {
    composing = true;
    changed = false;
    generation++;
  });
  listen("compositionend", () => {
    composing = false;
    changed = false;
  });
  const blur = () => {
    pointer = false;
    keyboard = false;
    finishing = false;
    changed = false;
    generation++;
  };
  window.addEventListener("blur", blur);
  listeners.push(() => window.removeEventListener("blur", blur));
  const changedBySdk = () => {
    if (!suppressed && !composing && (pointer || keyboard || finishing)) changed = true;
  };
  // The workbook callback's synchronous BehaviorSubject replay is not a gesture.
  const sheet =
    kind === "sheet" ? native.univerAPI.getWorkbook(unitId)?.onSelectionChange(changedBySdk) : null;
  const doc =
    kind === "doc"
      ? native.injector.get(DocSelectionManagerService).textSelection$.subscribe((event) => {
          if (event.unitId === unitId && event.subUnitId === unitId) changedBySdk();
        })
      : null;
  return {
    busy: () => disposed || composing || pointer || keyboard,
    composing: () => composing,
    generation: () => generation,
    suppress(value: boolean) {
      suppressed = value;
      changed = false;
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const remove of listeners) remove();
      sheet?.dispose();
      doc?.unsubscribe();
    },
  };
}
