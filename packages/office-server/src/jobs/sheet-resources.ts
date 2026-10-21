import { Predicate, Schema } from "effect";
import { decodeWireSync, OfficeInvalid, safeFailure } from "@starter/office-contract";

// These 1.0.3 serializers/onLoad handlers use empty object maps, not arbitrary empty graphs.
const emptyMaps = new Set([
  "SHEET_RANGE_THEME_MODEL_PLUGIN",
  "SHEET_DEFINED_NAME_PLUGIN",
  "SHEET_WORKSHEET_PROTECTION_PLUGIN",
  "SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN",
  "SHEET_RANGE_PROTECTION_PLUGIN",
  "SHEET_AuthzIoMockService_PLUGIN",
  "SHEET_FILTER_PLUGIN",
  "SHEET_DRAWING_PLUGIN",
  "SHEET_CONDITIONAL_FORMATTING_PLUGIN",
  "SHEET_NOTE_PLUGIN",
  "SHEET_TABLE_PLUGIN",
  "SHEET_DATA_VALIDATION_PLUGIN",
]);
const Resource = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  data: Schema.String,
});
const Resources = Schema.Array(Resource).check(Schema.isMaxLength(128));
function deny(): never {
  throw new OfficeInvalid(safeFailure("FORBIDDEN"));
}
function resources(value: unknown) {
  let rows: typeof Resources.Type;
  try {
    rows = decodeWireSync(Resources)(value === undefined ? [] : value);
  } catch {
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  }
  const map = new Map<string, typeof Resource.Type>();
  for (const resource of rows) {
    if (map.has(resource.name)) deny();
    map.set(resource.name, resource);
  }
  return map;
}
function empty(resource: typeof Resource.Type): boolean {
  if (!emptyMaps.has(resource.name) || (resource.id !== undefined && resource.id !== ""))
    return false;
  if (resource.data === "") return true; // ResourceManager skips this hook; it grants no authority.
  let data: unknown;
  try {
    data = JSON.parse(resource.data);
  } catch {
    return false;
  }
  return Predicate.isObject(data) && !Array.isArray(data) && Object.keys(data).length === 0;
}
/** Inspect ORIGINAL SOURCE resources before materialization can omit unknown hooks. Never sanitizes. */
export function requireEmptySheetResources(value: unknown): void {
  for (const resource of resources(value).values()) if (!empty(resource)) deny();
}
/** Called on the ACTUAL SDK createSnapshot result, before import proposal publication. */
export function requirePreservedSheetResources(before: unknown, after: unknown): void {
  const original = resources(before),
    saved = resources(after);
  for (const [name, resource] of original) {
    const actual = saved.get(name);
    if (empty(resource)) {
      if (actual !== undefined && !empty(actual)) deny();
    } else if (actual === undefined || actual.id !== resource.id || actual.data !== resource.data)
      deny();
  }
  for (const [name, resource] of saved) if (!original.has(name) && !empty(resource)) deny();
}
