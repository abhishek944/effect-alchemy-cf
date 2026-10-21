import type * as cf from "@cloudflare/workers-types";
import type { NativePrivateFile } from "../../office/src/native-private-wire.ts";
import { freezeImageRequestValue } from "./chat-image-request-values.ts";
import type { HostOfficeRequest } from "@starter/office-server/native-remote";
import type { OfficeInvocation } from "./office-invocations.ts";
import type { OfficeHostPlacements } from "./office-host-placements.ts";
import {
  officeDenied,
  type OfficePrivateRequest,
  type OfficePrivateIO,
} from "./office-private-authority.ts";
import { officeHostFrameIO } from "./office-host-frame-io.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import { officeNativeSignal } from "./office-platform.ts";

/** Resource scope only. Caller MUST select the original private registration after real binding proof. */
export class OfficeHostFrame {
  readonly id = crypto.randomUUID();
  readonly work = new AbortController();
  readonly cleanup = new AbortController();
  readonly io = officeHostFrameIO();
  readonly request: OfficePrivateRequest;
  readonly kind: "http" | "upgrade";
  readonly nativeFinished: Promise<void>;
  readonly socketClosed: Promise<void>;
  readonly sdkClosed: Promise<void>;
  sdkExpected = false;
  readonly original: OfficeInvocation;
  readonly deadline: number;
  readonly cleanupDeadline: number;
  private resolveFinished: (() => void) | undefined;
  private rejectFinished: ((error: unknown) => void) | undefined;
  private resolveSocket: (() => void) | undefined;
  private resolveSDK: (() => void) | undefined;
  private readonly deadlineTimer: ReturnType<typeof setTimeout>;
  private readonly cleanupTimer: ReturnType<typeof setTimeout>;
  private readonly calls = new Set<string>();
  private bytes = 0;
  private finished = false;
  private failed = false;
  private closed = false;
  constructor(options: {
    readonly original: OfficeInvocation;
    readonly command: HostOfficeRequest | null;
    readonly file: NativePrivateFile | null;
    readonly viewId: string | null;
    readonly kind: "http" | "upgrade";
    readonly self: cf.Fetcher;
    readonly placements: OfficeHostPlacements;
    readonly onStalled: () => void;
  }) {
    this.original = options.original;
    this.kind = options.kind;
    this.deadline = options.original.deadline;
    this.cleanupDeadline = this.deadline + 10_000;
    this.nativeFinished = new Promise<void>((resolve, reject) => {
      this.resolveFinished = resolve;
      this.rejectFinished = reject;
    });
    void this.nativeFinished.catch(() => undefined);
    this.socketClosed = new Promise<void>((resolve) => {
      this.resolveSocket = resolve;
    });
    this.sdkClosed = new Promise<void>((resolve) => {
      this.resolveSDK = resolve;
    });
    this.deadlineTimer = setTimeout(() => this.revoke(), Math.max(0, this.deadline - Date.now()));
    this.cleanupTimer = setTimeout(
      () => {
        if (!this.closed) options.onStalled();
      },
      Math.max(0, this.cleanupDeadline - Date.now()),
    );
    const live = async () => {
      this.work.signal.throwIfAborted();
      if (this.closed || this.io.isRevoked || Date.now() >= this.deadline) throw officeDenied();
      // Actual fresh Worker event: real authentication/epoch services, never serialized Effect/Headers.
      const response = await options.self.fetch("http://office-maintenance.internal/assert", {
        method: "POST",
        redirect: "manual",
        signal: officeNativeSignal(this.work.signal),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frameId: this.id }),
      });
      await readOfficePrivateJson(response.body, this.work.signal, this.deadline, 16 * 1024);
      if (response.status !== 200) throw officeDenied();
      this.work.signal.throwIfAborted();
    };
    this.request = Object.freeze({
      id: this.id,
      original: options.original,
      command: options.command,
      file: freezeImageRequestValue(structuredClone(options.file), true),
      viewId: options.viewId,
      cleanupDeadline: this.cleanupDeadline,
      signal: this.work.signal,
      currentPlacement: (documentId: string) => options.placements.current(documentId),
      live,
      charge: (bytes: number) => this.charge(bytes),
      receive: (callId: string) => this.receive(callId),
      keepIO: (resource: OfficePrivateIO, cleanup: boolean) => this.io.hold(resource, cleanup),
    });
  }
  private charge(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.bytes > 1024 * 1024 * 1024 - bytes)
      throw officeDenied();
    this.bytes += bytes;
  }
  private receive(callId: string): void {
    if (this.calls.has(callId) || this.calls.size >= 65536) throw officeDenied();
    this.calls.add(callId);
  }
  reportFinished(kind: "http" | "upgrade", clean: boolean): void {
    if (this.kind !== kind || this.finished) throw officeDenied();
    this.finished = true;
    if (clean) this.resolveFinished?.();
    else {
      this.failed = true;
      this.rejectFinished?.(officeDenied());
    }
  }
  reportSocketClosed(): void {
    if (this.kind !== "upgrade") throw officeDenied();
    this.resolveSocket?.();
  }
  reportSDKClosed(): void {
    this.resolveSDK?.();
  }
  revoke(): void {
    this.work.abort();
    this.io.revokeWork();
  }
  complete(): void {
    this.closed = true;
    clearTimeout(this.deadlineTimer);
    clearTimeout(this.cleanupTimer);
    this.revoke();
  }
  stopCleanup(): void {
    this.cleanup.abort();
    this.io.stop();
  }
  failCleanup(): void {
    this.failed = true;
    this.revoke();
  }
  get cleanupFailed() {
    return this.failed;
  }
  get isClosed() {
    return this.closed;
  }
}
