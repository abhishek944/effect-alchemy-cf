import { UnitObject } from "@univerjs/protocol";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import {
  transformSnapshotToDocumentData,
  transformSnapshotToSlideData,
} from "@univerjs-pro/collaboration";
import type { Kind } from "@starter/office-contract";

/** Product-native IDs only. Unknown/protected-range/management objects are not inferred from strings. */
export function nativePermissionObjects(
  kind: Kind,
  native: ISnapshotWithBlocks,
): ReadonlyMap<UnitObject, ReadonlySet<string>> {
  const objects = new Map<UnitObject, Set<string>>();
  const add = (type: UnitObject, id: string | undefined) => {
    if (id === undefined || id.length === 0 || id.length > 256) return;
    const ids = objects.get(type) ?? new Set<string>();
    ids.add(id);
    objects.set(type, ids);
  };
  if (kind === "sheet") {
    add(UnitObject.Workbook, native.snapshot.unitID);
    for (const id of Object.keys(native.snapshot.workbook?.sheets ?? {}))
      add(UnitObject.Worksheet, id);
  } else if (kind === "doc") {
    add(UnitObject.Document, native.snapshot.unitID);
    const data = transformSnapshotToDocumentData(structuredClone(native.snapshot));
    const stories = [
      data,
      ...Object.values(data.headers ?? {}),
      ...Object.values(data.footers ?? {}),
      ...Object.values(data.footnotes ?? {}),
      ...Object.values(data.endnotes ?? {}),
    ];
    for (const story of stories) {
      for (const paragraph of story.body?.paragraphs ?? [])
        add(UnitObject.DocumentParagraph, paragraph.paragraphId);
      for (const section of story.body?.sectionBreaks ?? [])
        add(UnitObject.DocumentSection, section.sectionId);
      for (const block of story.body?.customBlocks ?? [])
        add(UnitObject.DocumentEntity, block.blockId);
      for (const range of story.body?.customRanges ?? [])
        add(UnitObject.DocumentEntity, range.rangeId);
      if ("drawings" in story)
        for (const id of Object.keys(story.drawings ?? {})) add(UnitObject.DocumentEntity, id);
    }
  } else {
    add(UnitObject.Slide, native.snapshot.unitID);
    const data = transformSnapshotToSlideData(structuredClone(native.snapshot));
    const pages = [
      ...Object.values(data.slides),
      ...Object.values(data.layoutPages ?? {}),
      ...Object.values(data.masterPages ?? {}),
      ...Object.values(data.handoutMasterPages ?? {}),
      ...Object.values(data.notesMasterPages ?? {}),
    ];
    for (const page of pages) {
      add(UnitObject.SlidePage, page.id);
      for (const [id, element] of Object.entries(page.elements))
        if (element.id === id) add(UnitObject.SlideElement, id);
    }
    for (const page of [
      ...Object.values(data.masterPages ?? {}),
      ...Object.values(data.handoutMasterPages ?? {}),
      ...Object.values(data.notesMasterPages ?? {}),
    ])
      add(UnitObject.SlideMaster, page.id);
  }
  return objects;
}
