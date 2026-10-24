import type {
  NativeInvocation,
  NativeReadInvocation,
  NativeReadReferences,
  NativeValueRef,
} from "@starter/office-cloudflare/native";
import type { NativeTarget } from "@starter/office-server/ports";
import type { officeNativeWriter } from "./office-native-writer.ts";
import {
  officeDenied,
  type OfficePrivateRequest,
  type OfficePrivateIO,
} from "./office-private-authority.ts";

export type OfficeNativeHandle = {
  readonly id: string;
  readonly request: OfficePrivateRequest;
  readonly target: NativeTarget;
  readonly descriptor: boolean;
  readonly worktreeId: string | null;
  readonly baselineRevision: number | null;
  readonly deadline: number;
  readonly pair: NativeInvocation | NativeReadInvocation;
  readonly reader: NativeReadReferences | null;
  readonly reads: NativeReadReferences["reads"];
  originCache?: { readonly key: string; readonly values: Map<string, NativeValueRef> };
  readonly writer: Awaited<ReturnType<typeof officeNativeWriter>> | null;
  active: boolean;
  failed: boolean;
  readonly io: Set<OfficePrivateIO>;
  readonly pending: Set<Promise<void>>;
  closing?: Promise<void>;
};
/** Revoke before actual callback/provider joins. Disposal is NOT the promise-settlement proof. */
export function closeOfficeNativeHandle(handle: OfficeNativeHandle): Promise<void> {
  if (handle.closing !== undefined) return handle.closing;
  handle.active = false;
  handle.closing = Promise.resolve().then(async () => {
    const disposed = await Promise.allSettled([
      handle.pair.dispose(),
      handle.reader?.dispose(),
      ...[...handle.io].map((resource) => resource.close()),
    ]);
    while (handle.pending.size > 0) await Promise.all(handle.pending);
    delete handle.originCache;
    if (handle.failed || disposed.some((item) => item.status === "rejected")) throw officeDenied();
    return undefined;
  });
  return handle.closing;
}
/** Reclaim only successfully joined handles; retain small idempotent-close tombstones.
 * The original frame's call budget bounds history. Failed cleanup keeps its occupied slot. */
export async function retireOfficeNativeHandle(
  handles: Map<string, OfficeNativeHandle>,
  closed: Set<string>,
  id: string,
): Promise<void> {
  const handle = handles.get(id);
  if (handle === undefined) {
    if (closed.has(id)) return;
    throw officeDenied();
  }
  await closeOfficeNativeHandle(handle);
  closed.add(id);
  if (handles.get(id) === handle) handles.delete(id);
}
/** Actual body lease owned before response transfer. Close cancels it BEFORE joining its drain. */
export function holdOfficeNativeIO(handle: OfficeNativeHandle, resource: OfficePrivateIO): void {
  handle.io.add(resource);
  const observe = (actual: Promise<void>) => {
    const joined = actual.catch(() => {
      handle.failed = true;
    });
    handle.pending.add(joined);
    void joined.then(() => handle.pending.delete(joined));
  };
  observe(
    resource.drain().finally(() => {
      handle.io.delete(resource);
    }),
  );
  if (!handle.active) observe(Promise.resolve().then(() => resource.close()));
}
