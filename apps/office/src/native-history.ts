import type { IChangeset } from "@univerjs/protocol";
import { HostNativeReads } from "@starter/office-server/native-remote";
import { decodeChangeset } from "@starter/office-server/native-codec";
import type { NativeSession } from "./native-client.ts";
import type { NativeValues } from "./native-values.ts";
import { invalidBytes } from "./native-stream-io.ts";

type HistoryInput = (typeof HostNativeReads.changesets.request)["Type"]["input"];
type HistoryPage = Extract<
  (typeof HostNativeReads.changesets.response)["Type"],
  { readonly value: unknown }
>["value"];

/** Finite original-handle history; range is exclusive from, inclusive to, never a new read grant. */
export function readNativeHistory(
  s: NativeSession,
  values: NativeValues,
  branch: string,
  range: { readonly from: number; readonly to?: number },
): Promise<readonly IChangeset[] | null> {
  const { from, to } = range;
  return s.task(async () => {
    if (branch !== "" && branch !== s.worktreeId) throw invalidBytes();
    if (
      !Number.isSafeInteger(from) ||
      from < 0 ||
      (to !== undefined && (!Number.isSafeInteger(to) || to < from))
    )
      throw invalidBytes();
    const result: IChangeset[] = [],
      seen = new Set<string>();
    let cursor: string | null = null,
      head = from,
      total = 0;
    while (true) {
      const input: HistoryInput = {
        handleId: s.handleId,
        unitID: s.target.unitId,
        from,
        to: to ?? null,
        cursor,
      };
      const page: HistoryPage =
        branch === ""
          ? await s.call(HostNativeReads.changesets, input, false)
          : await s.call(HostNativeReads.draftChangesets, { ...input, worktreeID: branch }, false);
      if (page === null) {
        if (result.length) throw invalidBytes();
        return null;
      }
      if (page.rows.length > 128) throw invalidBytes();
      for (const row of page.rows) {
        if (
          row.unitID !== s.target.unitId ||
          row.value.kind !== "changeset" ||
          row.baseRev !== head ||
          row.revision !== head + 1 ||
          (to !== undefined && row.revision > to) ||
          result.length >= s.policy.limits.historyScanRevisions ||
          row.value.bytes > values.maximum - total
        )
          throw invalidBytes();
        total += row.value.bytes;
        const bytes = await values.load(
          { kind: "changeset", branch, revision: row.revision },
          row.value,
        );
        result.push(decodeChangeset(bytes, row));
        head = row.revision;
      }
      if (page.next === null) {
        if (to !== undefined && head < to) throw invalidBytes();
        return result;
      }
      if (!page.rows.length || seen.has(page.next)) throw invalidBytes();
      seen.add(page.next);
      cursor = page.next;
    }
  });
}
