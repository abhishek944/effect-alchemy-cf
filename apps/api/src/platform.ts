/**
 * The host-neutral replacement for the Workers type package. Chat objects and
 * the object store already keep the Durable Object and R2 shapes at their
 * private boundaries, so this module only renames DOM and local types rather
 * than asserting anything about a runtime that no longer exists.
 */
import type {
  ObjectStore,
  StoredObject,
  StoredObjectHead,
  StoredObjectList,
} from "@highchat/platform";

export type AbortSignal = globalThis.AbortSignal;
export type Response = globalThis.Response;
export type RequestInit = globalThis.RequestInit;
export type ReadableStream<Item = Uint8Array> = globalThis.ReadableStream<Item>;
export type ReadableStreamReadResult<Item> = globalThis.ReadableStreamReadResult<Item>;

/** A private chat object handle; only `fetch` is ever reachable. */
export interface DurableObjectStub {
  readonly id: { readonly name: string; toString(): string };
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespace {
  getByName(name: string): DurableObjectStub;
}

/** No Workers fixed-length stream exists; local writers accept any readable. */
export type FixedLengthStream = never;

export type R2Bucket = ObjectStore;
export type R2Object = StoredObjectHead;
export type R2ObjectBody = StoredObject;
export type R2Objects = StoredObjectList;
