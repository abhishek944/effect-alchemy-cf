import type { LocalFile } from "@/lib/chat-file-local";
import { usePinnedImage } from "./chat-pinned-image";
import type { PreviewLease } from "./chat-file-preview-types";

/**
 * Row thumbnail with its own pending pin.
 *
 * Preparation only validated structure/bitmap; the displayed `<img>` decodes
 * separately, so this keeps the row's exact lease retained until that decode
 * settles, even if the row is removed meanwhile.
 */
export default function FileThumbnail({ file }: { file: LocalFile }) {
  const lease: PreviewLease | null =
    file.reservationKey !== null && file.width !== null && file.height !== null
      ? {
          key: file.reservationKey,
          decodedBytes: file.width * file.height * 4,
          previewBytes: file.byteSize,
        }
      : null;
  const { imgRef } = usePinnedImage(file.previewUrl, lease);
  if (!file.previewUrl) return null;
  return <img key={file.previewUrl} ref={imgRef} data-cx="file-thumb" alt="" />;
}
