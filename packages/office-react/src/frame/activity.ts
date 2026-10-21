import { CommandType, IImageIoService, type Injector } from "@univerjs/core";
import type { FUniver } from "@univerjs/core/facade";
import { BehaviorSubject, filter, firstValueFrom, timeout } from "rxjs";

/** Track admitted SDK work before any unit loads; never guess async command completion. */
export function nativeActivity(api: FUniver, injector: Injector) {
  const commands = new Map<string, number>();
  const idle = new BehaviorSubject(true);
  let uploads = 0;
  let invalid = false;
  let disposed = false;
  let sealed: "read-only" | "all" | null = null;
  const publish = () => idle.next(!invalid && commands.size === 0 && uploads === 0);
  const before = api.addEvent(api.Event.BeforeCommandExecute, (event) => {
    if (event.options?.fromCollab || event.options?.fromChangeset) return;
    if (
      sealed !== null &&
      (event.type === CommandType.MUTATION ||
        (sealed === "all" && event.type === CommandType.COMMAND))
    ) {
      event.cancel = true;
      return;
    }
    if (event.type === CommandType.COMMAND && !event.cancel && !event.options?.syncOnly) {
      commands.set(event.id, (commands.get(event.id) ?? 0) + 1);
      publish();
    }
  });
  const after = api.addEvent(api.Event.CommandExecuted, (event) => {
    if (
      event.options?.fromCollab ||
      event.options?.fromChangeset ||
      event.options?.syncOnly ||
      event.type !== CommandType.COMMAND
    )
      return;
    const count = commands.get(event.id);
    if (count === undefined) return;
    if (count === 1) commands.delete(event.id);
    else commands.set(event.id, count - 1);
    publish();
  });
  const images = injector.has(IImageIoService) ? injector.get(IImageIoService) : null;
  const upload = images?.change$.subscribe((count) => {
    if (!Number.isSafeInteger(count) || count < 0) invalid = true;
    else uploads = count;
    publish();
  });
  return {
    idle: () => !disposed && idle.getValue(),
    unseal() {
      sealed = null;
    },
    seal(readOnly: boolean) {
      sealed = readOnly ? "read-only" : "all";
    },
    async wait() {
      if (disposed) throw new Error("Office native activity disposed.");
      await firstValueFrom(idle.pipe(filter(Boolean), timeout({ first: 30_000 })));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      before.dispose();
      after.dispose();
      upload?.unsubscribe();
      idle.complete();
    },
  };
}
