import { UniverType } from "@univerjs/protocol";
import { readDocDto, docReadError } from "./doc-read-io.ts";
import {
  DOC_READ_LIMITS,
  DocReadResult,
  DocUnit,
  NativeSnapshot,
  nativeValueDigest,
  validateNativeValueRef,
  type DocReadRequest,
  type DocReadBudget,
  type NativePartRequest,
} from "@starter/office-server/native-remote";
import type { NativeStorage, NativeReadAccess, NativeScope } from "./native/index.ts";

type Guard = () => Promise<void>;
/** Ref metadata only; no native document decoder, SQL or writer capability escapes. */
export async function openDocReadData(
  native: Pick<NativeStorage, "readInvocation" | "readReferences">,
  scope: NativeScope,
  access: NativeReadAccess,
  ceiling: number,
  { maxValueBytes, maxHistoryRevisions }: DocReadBudget,
  check: Guard,
) {
  const acquired: { dispose(): Promise<void> }[] = [];
  const seen = new Set<number>();
  let disposed = false;
  const close = async () => {
    disposed = true;
    const results = await Promise.allSettled(acquired.map((handle) => handle.dispose()));
    if (results.some((result) => result.status === "rejected")) throw docReadError("UNAVAILABLE");
  };
  const io = async <T>(guard: Guard, action: () => Promise<T>): Promise<T> => {
    if (disposed) throw docReadError("FORBIDDEN");
    await guard();
    if (disposed) throw docReadError("FORBIDDEN");
    const result = await action();
    await guard();
    if (disposed) throw docReadError("FORBIDDEN");
    return result;
  };
  try {
    const invocation = await io(check, async () => {
      const handle = await native.readInvocation(access);
      acquired.push(handle);
      return handle;
    });
    const refs = await io(check, async () => {
      const handle = await native.readReferences(access);
      acquired.push(handle);
      return handle;
    });
    const unit = async (guard: Guard): Promise<DocUnit | null> => {
      const value = await io(guard, () =>
        invocation.database.getUnit(
          { userID: scope.ownerID, customData: {}, request: { unitID: scope.unitID } },
          scope.unitID,
        ),
      );
      if (value === null) return null;
      const parsed = readDocDto(DocUnit, value);
      if (parsed.unitID !== scope.unitID) throw docReadError("CONTENT_REQUIRED");
      return parsed;
    };
    const valueRef = (input: unknown, kind: "snapshot" | "changeset") => {
      let value;
      try {
        value = validateNativeValueRef(input);
      } catch {
        throw docReadError("CONTENT_REQUIRED");
      }
      if (value.kind !== kind) throw docReadError("CONTENT_REQUIRED");
      if (value.bytes > maxValueBytes) throw docReadError("LIMIT_EXCEEDED");
      return value;
    };
    const snapshot = async (revision: number, guard: Guard) => {
      const raw = await io(guard, () => refs.reads.snapshot(revision));
      if (raw === null) return null;
      const manifest = readDocDto(NativeSnapshot, raw);
      const docType: number = UniverType.UNIVER_DOC;
      if (
        manifest.unitID !== scope.unitID ||
        manifest.type !== docType ||
        manifest.revision > revision ||
        manifest.blocks.length !== 0
      )
        throw docReadError("CONTENT_REQUIRED");
      valueRef(manifest.snapshot, "snapshot");
      return manifest;
    };
    const admitHistory = (after: number, to: number) => {
      if (after > to || to > ceiling) throw docReadError("FORBIDDEN");
      if (to - after > maxHistoryRevisions) throw docReadError("LIMIT_EXCEEDED");
      const count = Math.min(to - after, DOC_READ_LIMITS.historyPage);
      const revisions = Array.from({ length: count }, (_, index) => after + index + 1);
      if (
        seen.size + revisions.filter((revision) => !seen.has(revision)).length >
        maxHistoryRevisions
      )
        throw docReadError("LIMIT_EXCEEDED");
      revisions.forEach((revision) => seen.add(revision));
      return count;
    };
    const history = async (after: number, to: number, guard: Guard) => {
      const count = admitHistory(after, to);
      if (count === 0) return [];
      const rows = await io(guard, () => refs.reads.changesets("", after, count));
      if (rows.length !== count || rows.some((row, index) => row.revision !== after + index + 1))
        throw docReadError("HISTORY_INCOMPLETE");
      return rows.map((row) => ({ ...row, value: valueRef(row.value, "changeset") }));
    };
    return Object.freeze({
      unit,
      control: async (request: DocReadRequest, guard: Guard): Promise<DocReadResult> => {
        if (request.method === "snapshot" && request.revision > ceiling)
          throw docReadError("FORBIDDEN");
        if (request.method === "history" && (request.after > request.to || request.to > ceiling))
          throw docReadError("FORBIDDEN");
        const current = await unit(guard);
        if (request.method === "unit")
          return readDocDto(DocReadResult, { method: "unit", unit: current });
        if (request.method === "snapshot") {
          if (current && request.revision > current.headRevision) throw docReadError("FORBIDDEN");
          return readDocDto(DocReadResult, {
            method: "snapshot",
            manifest: current ? await snapshot(request.revision, guard) : null,
          });
        }
        if (!current) return readDocDto(DocReadResult, { method: "history", unit: null, rows: [] });
        if (request.to > current.headRevision) throw docReadError("FORBIDDEN");
        return readDocDto(DocReadResult, {
          method: "history",
          unit: current,
          rows: await history(request.after, request.to, guard),
        });
      },
      part: async (request: NativePartRequest, guard: Guard, admit: (bytes: number) => void) => {
        const origin = request.origin;
        if (
          (origin.kind !== "snapshot" && origin.kind !== "changeset") ||
          (origin.kind === "changeset" && origin.branch !== "") ||
          origin.revision > ceiling
        )
          throw docReadError("FORBIDDEN");
        const current = await unit(guard);
        if (!current || origin.revision > current.headRevision) throw docReadError("FORBIDDEN");
        let value;
        if (origin.kind === "snapshot") {
          const manifest = await snapshot(origin.revision, guard);
          if (!manifest || manifest.revision !== origin.revision) throw docReadError("FORBIDDEN");
          value = manifest.snapshot;
        } else {
          const row = (await history(origin.revision - 1, origin.revision, guard))[0];
          if (!row) throw docReadError("HISTORY_INCOMPLETE");
          value = row.value;
        }
        const digest = await io(guard, () => nativeValueDigest(value));
        const piece = value.parts[request.part];
        if (digest !== request.valueDigest || !piece) throw docReadError("FORBIDDEN");
        if (piece.bytes > DOC_READ_LIMITS.pieceBytes) throw docReadError("LIMIT_EXCEEDED");
        admit(piece.bytes);
        const bytes = await io(guard, () => refs.loadPiece(origin, piece));
        if (bytes.byteLength !== piece.bytes) throw docReadError("CONTENT_REQUIRED");
        return bytes;
      },
      dispose: close,
    });
  } catch (error) {
    await close();
    throw error;
  }
}
