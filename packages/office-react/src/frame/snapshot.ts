import type { ISnapshotServerService } from "@univerjs-pro/collaboration";
import type { View } from "@starter/office-contract";

const deny = () => Promise.reject(new Error("Frozen Office view is read-only."));
/** Real public SDK wire transport, scoped to one frozen view; never a fake snapshot implementation. */
export function pinnedSnapshotService(
  view: View,
  transport: ISnapshotServerService,
): ISnapshotServerService {
  return {
    getUnitOnRev(context, input) {
      if (input.unitID !== view.nativeTarget.unitId || input.revision !== view.revision)
        return deny();
      return transport.getUnitOnRev(context, input);
    },
    getSheetBlock(context, input) {
      if (input.unitID !== view.nativeTarget.unitId) return deny();
      return transport.getSheetBlock(context, input);
    },
    getDeserializedSheetBlock(context, input) {
      if (input.unitID !== view.nativeTarget.unitId) return deny();
      return transport.getDeserializedSheetBlock(context, input);
    },
    fetchMissingChangesets(context, input) {
      if (
        input.unitID !== view.nativeTarget.unitId ||
        input.from < 0 ||
        input.from > view.revision ||
        (input.to !== 0 && input.to > view.revision)
      )
        return deny();
      return transport.fetchMissingChangesets(context, {
        ...input,
        to: input.to === 0 ? view.revision : input.to,
      });
    },
    getResourcesRequest(context, input) {
      if (input.unitID !== view.nativeTarget.unitId) return deny();
      return transport.getResourcesRequest(context, input);
    },
    saveSnapshot: deny,
    updateSnapshot: deny,
    saveSheetBlock: deny,
    saveChangeset: deny,
    copyFileMeta: deny,
    getLatestCsReqIdBySid: deny,
  };
}
