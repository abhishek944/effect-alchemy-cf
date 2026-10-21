import "../frame/native.css";
import { IConfigService } from "@univerjs/core";
import { UnitAction, UnitObject, UniverType } from "@univerjs/protocol";
import {
  COLLABORATION_CLIENT_PLUGIN_CONFIG_KEY,
  CollaborationImageIoService,
  AuthzIoHttpService,
  SnapshotServerOverHTTPService,
} from "@univerjs-pro/collaboration-client";
import { createNativeApplication } from "../frame/native.ts";
import type { FrameInit } from "../frame/messages.ts";

const root = document.getElementById("office-native");
if (root === null) throw new Error("Trace fixture container missing.");
const query = new URLSearchParams(location.search);
const prefix = "/api/office/views/trace_view_000001/protocol";
const authzUrl = prefix + (query.get("authz") === "bare" ? "" : "/authz");
const input: FrameInit = {
  view: {
    id: "trace_view_000001",
    documentId: "trace_document_01",
    kind: "sheet",
    revision: 1,
    nativeTarget: { kind: "pinned-snapshot", unitId: "trace-native-unit" },
    mode: "read-only",
    protocolPrefix: prefix,
    expiresAt: Date.now() + 60_000,
  },
  user: { id: "trace-native-user", name: "Synthetic trace only" },
  theme: "dark",
  channelId: "trace_channel_01",
};
const native = createNativeApplication(root, "sheet", "dark", input.user);
const config = native.injector.get(IConfigService);
config.setConfig(
  COLLABORATION_CLIENT_PLUGIN_CONFIG_KEY,
  {
    authzUrl,
    snapshotServerUrl: location.origin + prefix + "/snapshot",
    ...(query.get("images") === "scoped"
      ? {
          uploadFileServerUrl: location.origin + prefix + "/images/upload",
          signUrlServerUrl: location.origin + prefix + "/images/sign",
          downloadEndpointUrl: location.origin,
        }
      : {}),
  },
  { merge: true },
);
const permission = native.injector.createInstance(AuthzIoHttpService);
const image = native.injector.createInstance(CollaborationImageIoService);
const snapshot = native.injector.createInstance(SnapshotServerOverHTTPService);
native.univerAPI.createWorkbook({ id: "trace-native-unit", name: "Native HTTP trace only" });
const results: { readonly operation: string; readonly outcome: string }[] = [];
const record = async (operation: string, run: () => Promise<unknown>) => {
  try {
    const value = await run();
    results.push({
      operation,
      outcome:
        value === null
          ? "SDK returned unavailable/null; no authentication/persistence success"
          : "SDK returned a value; not accepted as authentication proof",
    });
  } catch {
    results.push({
      operation,
      outcome:
        "Rejected; actual HTTP trace determines whether a request was sent. No auth/save success.",
    });
  }
};
const request = {
  unitID: "trace-native-unit",
  objectID: "trace-native-unit",
  objectType: UnitObject.Workbook,
  actions: [UnitAction.Edit, UnitAction.View],
};
await record("authz.batchAllowed", () => permission.batchAllowed([request]));
await record("authz.allowed", () => permission.allowed(request));
await record("snapshot.getUnitOnRev", () =>
  snapshot.getUnitOnRev(
    {},
    {
      unitID: "trace-native-unit",
      type: UniverType.UNIVER_SHEET,
      revision: 1,
    },
  ),
);
await record("snapshot.getDeserializedSheetBlock", () =>
  snapshot.getDeserializedSheetBlock(
    {},
    {
      unitID: "trace-native-unit",
      type: UniverType.UNIVER_SHEET,
      blockID: "trace-block",
    },
  ),
);
// The finite synthetic ID is not an arbitrary URL and no remote fallback is supplied.
await record("image.getImage", () => image.getImage("trace-image-file"));
if (query.get("images") === "templates") {
  const templates = ["{fileID}", "{fileId}", ":fileID", ":fileId", "${fileID}", "{file_id}"];
  for (const [index, template] of templates.entries()) {
    config.setConfig(
      COLLABORATION_CLIENT_PLUGIN_CONFIG_KEY,
      {
        signUrlServerUrl: `${location.origin}${prefix}/images/template-${index}/${template}/sign-url`,
      },
      { merge: true },
    );
    await record(`image.template.${template}`, () => image.getImage(`trace-image-${index}`));
  }
}
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
await record("image.saveImage", () =>
  image.saveImage(new File([png], "trace-image.png", { type: "image/png" })),
);
const output = document.createElement("pre");
output.id = "trace-results";
output.textContent = JSON.stringify(
  { authzUrl, images: query.get("images") ?? "default", results },
  null,
  2,
);
root.replaceChildren(output);
document.documentElement.dataset.officeTrace = "complete";
window.addEventListener("pagehide", () => native.univer.dispose(), { once: true });
