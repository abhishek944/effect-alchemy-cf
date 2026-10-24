import { Schema } from "effect";
import {
  Count,
  Digest,
  Id,
  OfficeForbidden,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import type { OfficeResolution } from "@starter/office-pi";
import type { ArtifactRef } from "@starter/office-contract";
import type { OfficeTaskProof } from "./office-task-proof.ts";
import { readOfficeStageReceipts, recordOfficeStageReceipt } from "./chat-office-stage-receipts.ts";
import { requireAcceptedInputAccess, type AcceptedInputAccess } from "./chat-accepted-input.ts";
import { sameAcceptedInputValue } from "./chat-accepted-input-values.ts";
import { resolveOfficeTaskAssociation } from "./chat-office-task-association.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";

const KEY = "office.host-scope.v1";
const Memo = Schema.Struct({
  version: Schema.Literal(1),
  id: Id,
  operationId: Id,
  digest: Digest,
  notAfter: Count,
});
export type OfficeTaskLease = { readonly id: string; readonly notAfter: number };
type Entry = {
  readonly lease: OfficeTaskLease;
  readonly resolution: OfficeResolution;
  readonly proof: OfficeTaskProof;
  readonly abort: () => void;
  revoked: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};
const denied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));

/** Owns only private callback association. Revocation is NOT a physical IO join or native grant. */
export class ChatOfficeTaskBroker {
  readonly #entries = new Map<string, Entry>();
  readonly #access: () => AcceptedInputAccess;
  readonly #records: ChatSendRecords;
  constructor(access: () => AcceptedInputAccess, records: ChatSendRecords) {
    this.#access = access;
    this.#records = records;
  }

  #revoke(entry: Entry): void {
    if (this.#entries.get(entry.lease.id) !== entry) return;
    entry.revoked = true;
    entry.resolution.context.abortSignal?.removeEventListener("abort", entry.abort);
  }

  #expire(entry: Entry): void {
    if (this.#entries.get(entry.lease.id) !== entry) return;
    const remaining = entry.lease.notAfter - Date.now();
    if (remaining > 0) {
      entry.timer = setTimeout(() => this.#expire(entry), remaining);
      return;
    }
    this.#revoke(entry);
    this.#entries.delete(entry.lease.id);
  }

  async capture(resolution: OfficeResolution): Promise<OfficeTaskProof> {
    const started = Date.now();
    const association = await resolveOfficeTaskAssociation(
      resolution,
      this.#access(),
      this.#records,
    );
    if (association === null) throw denied();
    const candidate = {
      version: 1,
      id: crypto.randomUUID(),
      operationId: resolution.intent.operationId,
      digest: resolution.intent.digest,
      notAfter: Math.min(association.session.expiresAt, started + 120_000),
    };
    // Actual native task memo is first-writer-wins; recovery cannot refresh this original deadline.
    const memo = decodeWireSync(Memo)(
      await resolution.api.memo(`${KEY}.${resolution.intent.step}`, candidate, resolution.context),
    );
    if (
      memo.operationId !== candidate.operationId ||
      memo.digest !== candidate.digest ||
      memo.notAfter > candidate.notAfter ||
      memo.notAfter <= Date.now()
    )
      throw denied();
    // The memo write is app state, not a new native authority. Recheck live binding cheaply;
    // Root issuance performs its own full proof reread and session recheck before any actor.
    requireAcceptedInputAccess(this.#access(), resolution.context);
    if (association.session.expiresAt <= Date.now()) throw denied();
    const stagedArtifacts = await readOfficeStageReceipts(resolution, association);
    const known = this.#entries.get(memo.id);
    if (known !== undefined) {
      if (
        known.revoked ||
        known.lease.notAfter !== memo.notAfter ||
        !sameAcceptedInputValue(known.proof.association, association) ||
        memo.notAfter <= Date.now() ||
        known.resolution.context.abortSignal?.aborted
      )
        throw denied();
      return known.proof;
    }
    if (this.#entries.size >= 128) throw new OfficeUnavailable(safeFailure("BUSY"));
    const lease = Object.freeze({ id: memo.id, notAfter: memo.notAfter });
    const entry: Entry = {
      lease,
      resolution,
      proof: Object.freeze({ lease, association, stagedArtifacts }),
      abort: () => this.#revoke(entry),
      revoked: false,
      timer: undefined,
    };
    this.#entries.set(memo.id, entry);
    try {
      entry.timer = setTimeout(() => this.#expire(entry), Math.max(0, memo.notAfter - Date.now()));
      resolution.context.abortSignal?.addEventListener("abort", entry.abort, { once: true });
      if (memo.notAfter <= Date.now() || resolution.context.abortSignal?.aborted) throw denied();
      return entry.proof;
    } catch (error) {
      // No lease was handed out; setup failure has no callback/foreign-work owner.
      this.#revoke(entry);
      clearTimeout(entry.timer);
      this.#entries.delete(entry.lease.id);
      throw error;
    }
  }

  /** A selector lookup only AFTER the caller establishes its actual private binding association. */
  async resolve(id: string): Promise<OfficeTaskProof | null> {
    const entry = this.#entries.get(id);
    if (
      entry === undefined ||
      entry.revoked ||
      entry.lease.notAfter <= Date.now() ||
      entry.resolution.context.abortSignal?.aborted
    ) {
      if (entry !== undefined) this.#revoke(entry);
      return null;
    }
    const current = await resolveOfficeTaskAssociation(
      entry.resolution,
      this.#access(),
      this.#records,
    );
    if (
      current === null ||
      !sameAcceptedInputValue(current, entry.proof.association) ||
      this.#entries.get(id) !== entry ||
      entry.revoked ||
      entry.lease.notAfter <= Date.now() ||
      entry.resolution.context.abortSignal?.aborted
    ) {
      this.#revoke(entry);
      return null;
    }
    return entry.proof;
  }

  /** Actual host uploader only, after verified provider ACK; an ID alone cannot record a receipt. */
  async acknowledge(lease: OfficeTaskLease, artifact: ArtifactRef): Promise<void> {
    const entry = this.#entries.get(lease.id);
    if (entry?.lease !== lease || (await this.resolve(lease.id)) === null) throw denied();
    await recordOfficeStageReceipt(
      entry.resolution,
      entry.proof.association,
      artifact,
      lease.notAfter,
    );
    // An admitted commit may settle after revocation. Keep its history, but never ACK stale eligibility.
    const current = await this.resolve(lease.id);
    if (
      current?.lease !== lease ||
      this.#entries.get(lease.id) !== entry ||
      entry.revoked ||
      entry.resolution.context.abortSignal?.aborted ||
      lease.notAfter <= Date.now()
    )
      throw denied();
  }

  /** Exact in-process owner only; never expose an ID-only public release endpoint. */
  revoke(lease: OfficeTaskLease): void {
    const entry = this.#entries.get(lease.id);
    if (entry?.lease === lease) this.#revoke(entry);
  }
}
