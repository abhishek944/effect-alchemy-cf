import { OfficeLimited, safeFailure } from "@starter/office-contract";
/** Leave room below Core's 12 KiB public page budget for projection and cursor framing. */
export const discoveryPageBytes = 8 * 1024;
export function requirePageProgress(fetched: number, emitted: number): void {
  if (fetched > 0 && emitted === 0) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
}
