/** Browser mirror of the bounded OOXML allowlist and structural check. */
export const OFFICE_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;
export type OfficeExtension = keyof typeof OFFICE_TYPES;
export const OFFICE_MEDIA_TYPES: readonly string[] = Object.values(OFFICE_TYPES);
export const OFFICE_MEDIA_PATTERN =
  "application/vnd\\.openxmlformats-officedocument\\.(?:spreadsheetml\\.sheet|wordprocessingml\\.document|presentationml\\.presentation)";

const markers: Record<OfficeExtension, string> = { xlsx: "xl/", docx: "word/", pptx: "ppt/" };

const isOfficeExtension = (value: string): value is OfficeExtension =>
  value === "xlsx" || value === "docx" || value === "pptx";

export const officeMediaType = (extension: string): string | null =>
  isOfficeExtension(extension) ? OFFICE_TYPES[extension] : null;

export const isOfficeMediaType = (mediaType: string): boolean =>
  OFFICE_MEDIA_TYPES.includes(mediaType);

const hasAscii = (bytes: Uint8Array, text: string): boolean => {
  const wanted: number[] = [];
  for (let index = 0; index < text.length; index += 1) wanted.push(text.charCodeAt(index));
  outer: for (let offset = 0; offset + wanted.length <= bytes.byteLength; offset += 1) {
    for (let index = 0; index < wanted.length; index += 1) {
      if (bytes[offset + index] !== wanted[index]) continue outer;
    }
    return true;
  }
  return false;
};

export const isOfficeContainer = (bytes: Uint8Array, extension: string): boolean => {
  const marker = isOfficeExtension(extension) ? markers[extension] : null;
  return (
    marker !== null &&
    bytes.byteLength > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04 &&
    hasAscii(bytes, "[Content_Types].xml") &&
    hasAscii(bytes, marker)
  );
};
