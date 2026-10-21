import { fileURLToPath, URL } from "node:url";

/** Source/build wiring only; this module is NOT imported into browser or Node document host code. */
const officeStorageModule = fileURLToPath(new URL("./office-storage-entry.ts", import.meta.url));
export const officeObjectExports = `export { OfficeStorageIngress as OfficeStorage } from ${JSON.stringify(officeStorageModule)};`;
