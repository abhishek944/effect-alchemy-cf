import type { AgentContext } from "agents";
import { DomainUuid } from "./chat-capabilities.ts";
import {
  bindingJson,
  decodeCandidate,
  encodeCandidate,
  ImageResponseError,
  responseBoundary,
  responseValue,
} from "./chat-image-response-codec.ts";
import {
  ImageAcceptedBinding,
  ImageBoundInput,
  ImageResponseIdentity,
  ImageResponseIndex,
  type ImageResponseCandidate,
} from "./chat-image-response-schema.ts";
import { ImageResponseTable } from "./chat-image-response-table.ts";
import {
  attemptCandidates,
  decodeCandidateRow,
  responsePageSize,
  unboundCandidates,
  type ImageResponsePage,
} from "./chat-image-response-pages.ts";
export type { ImageResponsePage } from "./chat-image-response-pages.ts";

/** Immutable response metadata only: no inference, original I/O or paid-call admission. */
export class ChatImageResponseStore {
  private readonly table: ImageResponseTable;
  private readonly storage: AgentContext["storage"];
  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    this.table = responseBoundary(() => new ImageResponseTable(storage));
  }

  read(operationId: string): ImageResponseCandidate | null {
    return responseBoundary(() => {
      responseValue(DomainUuid, operationId);
      const row = this.table.candidate(operationId);
      if (row === undefined) return null;
      const value = decodeCandidateRow(row);
      if (value.operationId !== operationId) throw new ImageResponseError("corrupt");
      return value;
    });
  }

  insert(candidate: ImageResponseCandidate): ImageResponseCandidate {
    return responseBoundary(() => {
      const json = encodeCandidate(candidate);
      const frozen = decodeCandidate(json);
      return this.storage.transactionSync(() => {
        const known = this.read(frozen.operationId);
        if (known !== null) {
          if (encodeCandidate(known) !== json) throw new ImageResponseError("conflict");
          return known;
        }
        if (this.table.operationBinding(frozen.operationId) !== undefined)
          throw new ImageResponseError("corrupt");
        this.table.insertCandidate(frozen, json);
        return frozen;
      });
    });
  }

  bindAccepted(binding: ImageAcceptedBinding): ImageBoundInput {
    return responseBoundary(() => {
      const valid = Object.freeze(responseValue(ImageAcceptedBinding, binding));
      return this.storage.transactionSync(() => {
        const candidate = this.read(valid.operationId);
        if (candidate === null) throw new ImageResponseError("conflict");
        responseValue(ImageBoundInput, { candidate, binding: valid }, "conflict");
        const existing = this.table.operationBinding(valid.operationId);
        const tuple = this.table.entryBinding(
          valid.conversationId,
          valid.entryId,
          valid.modelIndex,
        );
        const start = this.eraStart(valid.conversationId);
        if (existing !== undefined) {
          const known = this.bound(existing);
          if (bindingJson(known.binding) !== bindingJson(valid))
            throw new ImageResponseError("conflict");
          if (tuple === undefined || bindingJson(this.bound(tuple).binding) !== bindingJson(valid))
            throw new ImageResponseError("corrupt");
          return known;
        }
        if (tuple !== undefined) {
          this.bound(tuple);
          throw new ImageResponseError("conflict");
        }
        if (start !== null && valid.entryId < start) throw new ImageResponseError("conflict");
        this.table.insertBinding(valid);
        if (start === null) this.table.insertStart(valid.conversationId, valid.entryId);
        return Object.freeze({ candidate, binding: valid });
      });
    });
  }

  forEntry(conversationId: string, entryId: number, modelIndex: number): ImageBoundInput | null {
    return responseBoundary(() => {
      responseValue(ImageResponseIdentity, conversationId);
      this.entryIndex(entryId);
      responseValue(ImageResponseIndex, modelIndex);
      const start = this.eraStart(conversationId);
      const row = this.table.entryBinding(conversationId, entryId, modelIndex);
      if (row === undefined) return null;
      const result = this.bound(row);
      if (
        start === null ||
        result.binding.conversationId !== conversationId ||
        result.binding.entryId !== entryId ||
        result.binding.modelIndex !== modelIndex
      )
        throw new ImageResponseError("corrupt");
      return result;
    });
  }

  isImageEra(conversationId: string, entryId: number): boolean {
    return responseBoundary(() => {
      responseValue(ImageResponseIdentity, conversationId);
      this.entryIndex(entryId);
      const start = this.eraStart(conversationId);
      return start !== null && entryId >= start;
    });
  }

  attempts(logicalOperationId: string, after?: string, limit = 30): ImageResponsePage {
    return responseBoundary(() => {
      responseValue(DomainUuid, logicalOperationId);
      if (after !== undefined) {
        const cursor = this.read(after);
        if (cursor === null || cursor.logicalOperationId !== logicalOperationId)
          throw new ImageResponseError("invalid_input");
      }
      const rows = this.table.page(logicalOperationId, after ?? "", responsePageSize(limit));
      return attemptCandidates(rows, logicalOperationId, after, limit);
    });
  }

  /** Empty pages can have a cursor: callers must finish the bounded scan. */
  unbound(after?: string, limit = 30): ImageResponsePage {
    return responseBoundary(() => {
      if (after !== undefined && this.read(after) === null)
        throw new ImageResponseError("invalid_input");
      const rows = this.table.candidateWindow(after ?? "", responsePageSize(limit));
      return unboundCandidates(rows, after, limit);
    });
  }

  private entryIndex(entryId: number): void {
    responseValue(ImageResponseIndex, entryId);
    if (entryId === 0) throw new ImageResponseError("invalid_input");
  }

  private eraStart(conversationId: string): number | null {
    const start = this.table.start(conversationId);
    const first = this.table.firstBoundEntry(conversationId);
    if (start === undefined && first === undefined) return null;
    responseValue(ImageResponseIndex, start, "corrupt");
    if (start === undefined || start === 0 || start !== first)
      throw new ImageResponseError("corrupt");
    return start;
  }

  private bound(raw: ImageAcceptedBinding): ImageBoundInput {
    const binding = Object.freeze(responseValue(ImageAcceptedBinding, raw, "corrupt"));
    const candidate = this.read(binding.operationId);
    if (candidate === null) throw new ImageResponseError("corrupt");
    const start = this.eraStart(binding.conversationId);
    if (start === null || binding.entryId < start) throw new ImageResponseError("corrupt");
    responseValue(ImageBoundInput, { candidate, binding }, "corrupt");
    return Object.freeze({ candidate, binding });
  }
}
