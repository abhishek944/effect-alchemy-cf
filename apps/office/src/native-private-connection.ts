import type { Schema } from "effect";
import {
  OfficeForbidden,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import { HostId } from "@starter/office-server/native-remote";
import { readOfficeControlBody } from "./native-channel-body.ts";

const forbidden = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
/** Concrete Node -> native outbound Worker binding. No cookie, token, retry or selectable upstream. */
export class NativePrivateConnection {
  readonly bootId: string;
  readonly origin: string;
  private failed = false;
  private bytes = 0;
  constructor(bootId: string, origin: string) {
    this.bootId = decodeWireSync(HostId)(bootId);
    if (origin !== "http://office-storage.internal") throw forbidden();
    this.origin = origin;
  }
  /** Boot/header IDs only correlate the original platform binding; Worker proves process BEFORE lookup. */
  readonly request = (input: Request): Promise<Response> => {
    const url = new URL(input.url);
    if (
      this.failed ||
      url.origin !== this.origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      return Promise.reject(forbidden());
    for (const name of ["cookie", "authorization", "proxy-authorization"])
      if (input.headers.has(name)) return Promise.reject(forbidden());
    const headers = new Headers(input.headers);
    headers.set("x-office-boot", this.bootId);
    return fetch(
      new Request(input, {
        headers,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      }),
    );
  };
  async json<S extends Schema.ConstraintDecoder<unknown>>(
    path: string,
    value: unknown,
    schema: S,
    signal: AbortSignal,
    deadline: number,
  ): Promise<S["Type"]> {
    signal.throwIfAborted();
    if (
      !/^\/(bootstrap\/(ready|shutdown|stopped)|private\/[A-Za-z0-9_-]{1,256}\/(resolve|member|member-check|submission|closed|finished|socket-closed|job-status))$/.test(
        path,
      )
    )
      throw forbidden();
    if (Date.now() >= deadline) throw forbidden();
    const body = JSON.stringify(value);
    if (new TextEncoder().encode(body).byteLength > 16 * 1024) throw forbidden();
    const stop = new AbortController();
    const linked = AbortSignal.any([signal, stop.signal]);
    const timer = setTimeout(() => stop.abort(), Math.max(0, deadline - Date.now()));
    timer.unref();
    try {
      const response = await this.request(
        new Request(this.origin + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: linked,
        }),
      );
      const bytes = await readOfficeControlBody(
        response,
        linked,
        deadline,
        (count) => {
          this.bytes += count;
          if (this.bytes > 64 * 1024 * 1024) throw forbidden();
        },
        () => {
          this.failed = true;
          stop.abort();
        },
        16 * 1024,
      );
      if (
        response.status !== 200 ||
        response.headers.get("content-type")?.split(";")[0] !== "application/json"
      )
        throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
      return decodeWireSync(schema)(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
