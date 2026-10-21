import "../styles.css";
import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { OfficeNativeEditor } from "../editor.tsx";
import type { View } from "@starter/office-contract";
import type { FrameStatus, NativeTheme } from "../frame/messages.ts";

const container = document.getElementById("probe-root");
const output = document.getElementById("probe-result");
if (container === null || output === null) throw new Error("Bootstrap probe root missing.");
const root = createRoot(container);
const statuses: FrameStatus[] = [];
let waiter: { expected: FrameStatus; accept(): void } | null = null;
const waitStatus = (expected: FrameStatus) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiter = null;
      reject(new Error("Bootstrap status timeout."));
    }, 15_000);
    waiter = {
      expected,
      accept: () => {
        clearTimeout(timer);
        waiter = null;
        resolve();
      },
    };
  });
const onStatus = (status: FrameStatus) => {
  statuses.push(status);
  if (waiter?.expected === status) waiter.accept();
};
const makeView = (id: string, unitId: string): View => ({
  id,
  documentId: "bootstrap_document_000001",
  kind: "sheet",
  revision: 1,
  nativeTarget: { kind: "pinned-snapshot", unitId },
  mode: "read-only",
  protocolPrefix: `/api/office/views/${id}/protocol`,
  expiresAt: Date.now() - 1000,
});
const frameUrl = new URL("./bootstrap-frame.html", location.href).href;
const user = { id: "bootstrap-human", name: "Bootstrap probe" };
const editor = (view: View, theme: NativeTheme) => (
  <OfficeNativeEditor
    view={view}
    user={user}
    theme={theme}
    channelId="bootstrap_channel_000001"
    frameUrl={frameUrl}
    onStatus={onStatus}
  />
);
const render = (view: View, theme: NativeTheme) =>
  flushSync(() => root.render(editor(view, theme)));
const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const hints = (frame: HTMLIFrameElement) => {
  const data = frame.contentDocument?.documentElement.dataset;
  return {
    viewId: data?.officeProbeView,
    unitId: data?.officeProbeUnit,
    expiresAt: Number(data?.officeProbeExpiry),
    theme: data?.officeProbeTheme,
  };
};
const lateInitial = makeView("bootstrap_late_000001", "bootstrap-late-unit");
const lateRenewed = { ...lateInitial, expiresAt: Date.now() + 90_000 };
function LateProps() {
  const [metadata, setMetadata] = useState<{ view: View; theme: NativeTheme }>({
    view: lateInitial,
    theme: "dark",
  });
  useLayoutEffect(() => {
    setMetadata({ view: lateRenewed, theme: "light" });
  }, []);
  return editor(metadata.view, metadata.theme);
}
try {
  const initial = makeView("bootstrap_view_000001", "bootstrap-native-unit");
  const expired = waitStatus("error");
  render(initial, "dark");
  await expired;
  const frame = container.querySelector("iframe");
  if (frame === null) throw new Error("Actual native frame missing.");
  await new Promise<void>((resolve, reject) => {
    if (frame.contentDocument?.readyState === "complete") {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("Frame load timeout.")), 15_000);
    frame.addEventListener(
      "load",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
  let loads = 0;
  frame.addEventListener("load", () => {
    loads++;
  });
  const originalDocument = frame.contentDocument;
  const timeOrigin = frame.contentWindow?.performance.timeOrigin;
  const renewed = { ...initial, expiresAt: Date.now() + 90_000 };
  render(renewed, "light");
  await paint();
  render({ ...initial, expiresAt: initial.expiresAt - 1 }, "light");
  await paint();
  const errorsBefore = statuses.filter((value) => value === "error").length;
  render(
    {
      ...renewed,
      expiresAt: renewed.expiresAt + 30_000,
      nativeTarget: { kind: "pinned-snapshot", unitId: "forbidden-bootstrap-retarget" },
    },
    "light",
  );
  await paint();
  const rejectedRetarget = statuses.filter((value) => value === "error").length > errorsBefore;
  const preserved =
    container.querySelector("iframe") === frame &&
    frame.contentDocument === originalDocument &&
    frame.contentWindow?.performance.timeOrigin === timeOrigin &&
    loads === 0;
  if (!preserved || !rejectedRetarget)
    throw new Error("Renewal remounted or retargeted the native frame.");
  const loading = waitStatus("loading");
  frame.contentWindow?.location.reload();
  await loading;
  await waitStatus("error");
  const renewedHints = hints(frame);
  if (
    renewedHints.viewId !== initial.id ||
    renewedHints.unitId !== "bootstrap-native-unit" ||
    renewedHints.expiresAt !== renewed.expiresAt ||
    renewedHints.theme !== "light"
  )
    throw new Error("Reload did not use the exact renewed expiry/latest theme/original identity.");
  const requests =
    frame.contentWindow?.performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(`${location.origin}${initial.protocolPrefix}/`)) ?? [];
  if (
    !requests.some((name) => name.includes("/unit/bootstrap-native-unit/")) ||
    requests.some((name) => name.includes("forbidden-bootstrap-retarget"))
  )
    throw new Error("Original native bootstrap request identity not observed.");
  const lateLoading = waitStatus("loading");
  flushSync(() => root.render(<LateProps />));
  await lateLoading;
  await waitStatus("error");
  const lateFrame = container.querySelector("iframe");
  if (lateFrame === null) throw new Error("Late-props native frame missing.");
  const lateHints = hints(lateFrame);
  if (
    lateHints.expiresAt !== lateRenewed.expiresAt ||
    lateHints.theme !== "light" ||
    lateHints.unitId !== "bootstrap-late-unit"
  )
    throw new Error("Late props were not synchronized before bootstrap.");
  if (statuses.some((status) => status === "saved" || status === "read-only"))
    throw new Error("Denying fixture unexpectedly reported native readiness.");
  output.textContent = JSON.stringify(
    {
      scope:
        "Actual React + production mountOfficeFrame with passive metadata observation; local API denies all requests. No admitted native input, socket reconnect, authenticated save or storage proof.",
      initialExpiredRejected: true,
      sameFrameDocumentPreservedOnRenewal: preserved,
      rollbackIgnored: true,
      retargetRejected: rejectedRetarget,
      renewedHints,
      lateHints,
      explicitReloadPassedExpiryPreflight: true,
      latestThemeUsed: true,
      latePropsBeforeBootstrap: true,
      rebootstrapEndedInError: true,
      requests,
      statuses,
    },
    null,
    2,
  );
  document.documentElement.dataset.officeBootstrap = "complete";
} catch (error) {
  console.error("Bootstrap metadata probe failed", error);
  output.textContent = "Bootstrap metadata probe failed. No auth/storage/save success is claimed.";
  document.documentElement.dataset.officeBootstrap = "error";
} finally {
  flushSync(() => root.unmount());
}
