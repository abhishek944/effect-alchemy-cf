import { createHash } from "node:crypto";
import type { ISnapshot, ISheetBlock } from "@univerjs/protocol";
import { decodeWireSync, OfficeForbidden, safeFailure } from "@starter/office-contract";
import {
  NativeSnapshot,
  HostNativePieces,
  nativeValueDigest,
  validateNativeValueRef,
  type NativeValue,
  type PublishedOrigin,
  type HostValueHeader,
  type HostNativeProducer,
  type NativeProducer,
} from "@starter/office-server/native-remote";
import {
  decodeSnapshot,
  decodeBlock,
  requireNativeProducer,
  type SnapshotIdentity,
} from "@starter/office-server/native-codec";
import { readNativeHistory } from "./native-history.ts";
import type { NativeSession } from "./native-client.ts";
import { readBytes, invalidBytes, nativeId } from "./native-stream-io.ts";

/** Values remain bound to the ORIGINAL handle/access; no fake read tag or arbitrary key loader. */
export class NativeValues {
  readonly maximum: number;
  private readonly blocks = new Map<string, { origin: PublishedOrigin; value: NativeValue }>();
  readonly session: NativeSession;
  constructor(session: NativeSession) {
    this.session = session;
    this.maximum = Math.min(session.policy.limits.nativeBytes, 128 * 1024 * 1024);
  }
  private origin(origin: PublishedOrigin): void {
    const s = this.session;
    s.check();
    if (
      (origin.kind === "seed" || origin.kind === "merge-artifact") &&
      origin.worktreeID !== s.worktreeId
    )
      throw invalidBytes();
    if (origin.kind === "changeset" && origin.branch !== "" && origin.branch !== s.worktreeId)
      throw invalidBytes();
    if (
      !(s.worktreeId === null || s.access.kind === "write") &&
      (origin.kind === "snapshot" || (origin.kind === "changeset" && origin.branch === "")) &&
      (s.baselineRevision === null || origin.revision > s.baselineRevision)
    )
      throw invalidBytes();
  }
  load(source: PublishedOrigin, input: NativeValue): Promise<Uint8Array> {
    return this.session.task(async () => {
      this.origin(source);
      const ref = validateNativeValueRef(structuredClone(input));
      if (ref.bytes > this.maximum || ref.parts.length > 32) throw invalidBytes();
      const digest = await nativeValueDigest(ref),
        bytes = new Uint8Array(ref.bytes);
      let offset = 0;
      for (let index = 0; index < ref.parts.length; index++) {
        const part = ref.parts[index];
        if (!part || part.bytes > 4 * 1024 * 1024) throw invalidBytes();
        this.origin(source);
        const response = await this.session.exchange(
          HostNativePieces.read,
          { handleId: this.session.handleId, origin: source, valueDigest: digest, part: index },
          { body: null, requestBytes: 0, responseLimit: part.bytes, mutation: false },
        );
        const actual = await readBytes(
          response.body,
          part.bytes,
          4 * 1024 * 1024,
          part.digest,
          this.session.readers,
          () => this.origin(source),
        );
        if (
          response.value.key !== part.key ||
          response.value.bytes !== part.bytes ||
          response.value.digest !== part.digest
        )
          throw invalidBytes();
        bytes.set(actual, offset);
        offset += actual.byteLength;
      }
      this.origin(source);
      if (offset !== ref.bytes) throw invalidBytes();
      return bytes;
    });
  }
  producer(expected: SnapshotIdentity, digest: string, source: NativeProducer["source"]) {
    this.session.write();
    const { access, policy } = this.session;
    if (access.kind !== "write") throw new OfficeForbidden(safeFailure("FORBIDDEN"));
    const p = access.permit;
    for (const id of [p.operationId, p.stepId, expected.unitID]) nativeId(id);
    const claim = {
      operationId: p.operationId,
      stepId: p.stepId,
      ...expected,
      contentDigest: digest,
      policyVersion: policy.version,
      sdkVersion: policy.sdkVersion,
      imageDigest: policy.imageDigest,
      source,
    };
    return requireNativeProducer(claim, p, policy, expected, digest, source);
  }
  stage(
    bytes: Uint8Array,
    header: typeof HostValueHeader.Type,
    producer: HostNativeProducer,
  ): Promise<NativeValue> {
    return this.session.task(async () => {
      this.session.write();
      if (bytes.byteLength < 1 || bytes.byteLength > this.maximum) throw invalidBytes();
      const parts: NativeValue["parts"][number][] = [];
      for (let offset = 0; offset < bytes.byteLength; offset += 4 * 1024 * 1024) {
        const part = bytes.slice(offset, offset + 4 * 1024 * 1024);
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(part);
            c.close();
          },
        });
        const response = await this.session.exchange(
          HostNativePieces.stage,
          { handleId: this.session.handleId },
          { body, requestBytes: part.byteLength, responseLimit: 0, mutation: true },
        );
        await readBytes(response.body, 0, 0, null, this.session.readers, () =>
          this.session.check(),
        );
        if (
          response.value.bytes !== part.byteLength ||
          response.value.digest !== createHash("sha256").update(part).digest("hex")
        )
          throw invalidBytes();
        parts.push(response.value);
      }
      const value = validateNativeValueRef({
        codec: "office-native-msgpack-v1",
        kind: header.kind,
        bytes: bytes.byteLength,
        parts,
      });
      const stored = await this.session.call(
        HostNativePieces.register,
        { handleId: this.session.handleId, value, header, producer },
        true,
      );
      if ((await nativeValueDigest(stored)) !== (await nativeValueDigest(value)))
        throw invalidBytes();
      return stored;
    });
  }
  snapshot(input: NativeSnapshot, origin: PublishedOrigin): Promise<ISnapshot> {
    return this.session.task(async () => {
      const ref = decodeWireSync(NativeSnapshot)(structuredClone(input));
      this.session.check(undefined, ref.unitID);
      if (
        ref.snapshot.kind !== "snapshot" ||
        ref.blocks.some((b) => b.value.kind !== "block") ||
        ref.blocks.length > Math.min(4096, this.session.policy.limits.blockCount) ||
        ref.snapshot.bytes + ref.blocks.reduce((n, b) => n + b.value.bytes, 0) > this.maximum
      )
        throw invalidBytes();
      const snapshot = decodeSnapshot(await this.load(origin, ref.snapshot), {
        unitID: ref.unitID,
        type: ref.type,
        revision: ref.revision,
      });
      const required = new Set(
        Object.values(snapshot.workbook?.blockMeta ?? {}).flatMap((meta) => meta.blocks),
      );
      if (required.size !== ref.blocks.length) throw invalidBytes();
      for (const block of ref.blocks) {
        nativeId(block.blockID);
        if (!required.delete(block.blockID)) throw invalidBytes();
        const previous = this.blocks.get(block.blockID);
        if (
          previous &&
          (await nativeValueDigest(previous.value)) !== (await nativeValueDigest(block.value))
        )
          throw invalidBytes();
        if (!previous && this.blocks.size >= Math.min(4096, this.session.policy.limits.blockCount))
          throw invalidBytes();
        if (!previous) this.blocks.set(block.blockID, { origin, value: block.value });
      }
      return snapshot;
    });
  }
  async block(blockID: string): Promise<ISheetBlock | null> {
    nativeId(blockID);
    const ref = this.blocks.get(blockID);
    return ref ? decodeBlock(await this.load(ref.origin, ref.value), blockID) : null;
  }
  history(branch: string, range: { readonly from: number; readonly to?: number }) {
    return readNativeHistory(this.session, this, branch, range);
  }
}
