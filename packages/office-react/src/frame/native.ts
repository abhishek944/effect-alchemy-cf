import { createUniver, type IPresetPlugin } from "@univerjs/presets";
import {
  Injector,
  type DependencyOverride,
  IConfigService,
  IAuthzIoService,
  IImageIoService,
  LocaleType,
  UserManagerService,
} from "@univerjs/core";
import {
  UniverCollaborationPlugin,
  SnapshotService,
  RevisionService,
  ISnapshotServerService,
} from "@univerjs-pro/collaboration";
import {
  UniverCollaborationClientPlugin,
  COLLABORATION_CLIENT_PLUGIN_CONFIG_KEY,
  SnapshotServerOverHTTPService,
  AuthzIoHttpService,
  CollaborationImageIoService,
} from "@univerjs-pro/collaboration-client";
import { nativePresets, nativeLocales } from "./presets.ts";
import { OfficeFramePlugin } from "./injector-plugin.ts";
import { nativeTransport } from "./transport.ts";
import { pinnedSnapshotService } from "./snapshot.ts";
import { nativeActivity } from "./activity.ts";
import type { FrameInit, NativeTheme, NativeUser } from "./messages.ts";
import type { Kind } from "@starter/office-contract";

export function createNativeApplication(
  container: HTMLElement,
  kind: Kind,
  theme: NativeTheme,
  user: NativeUser,
  remote?: FrameInit,
) {
  let captured: Injector | null = null;
  const pinned = remote?.view.nativeTarget.kind === "pinned-snapshot";
  const transport = remote === undefined ? undefined : nativeTransport(remote);
  const capture = (injector: Injector) => {
    captured = injector;
    if (transport === undefined || !pinned || remote === undefined) return;
    injector.get(IConfigService).setConfig(COLLABORATION_CLIENT_PLUGIN_CONFIG_KEY, transport);
    // Pinned loads install real wire/image services, not a live client/controller/facade.
    injector.add([
      ISnapshotServerService,
      {
        deps: [Injector],
        useFactory: (scope: Injector) =>
          pinnedSnapshotService(remote.view, scope.createInstance(SnapshotServerOverHTTPService)),
      },
    ]);
    injector.add([IImageIoService, { useClass: CollaborationImageIoService }]);
  };
  const plugins: IPresetPlugin[] = [[OfficeFramePlugin, capture]];
  if (transport !== undefined) {
    plugins.push(UniverCollaborationPlugin);
    if (!pinned) plugins.push([UniverCollaborationClientPlugin, transport]);
  }
  const override: DependencyOverride = pinned
    ? [[IAuthzIoService, { useClass: AuthzIoHttpService }]]
    : [];
  const native = createUniver({
    locale: LocaleType.EN_US,
    locales: nativeLocales,
    darkMode: theme === "dark",
    logCommandExecution: false,
    ...(transport !== undefined && !pinned ? { collaboration: true } : {}),
    presets: nativePresets(container, kind, remote !== undefined),
    plugins,
    override,
  });
  if (captured === null) {
    native.univer.dispose();
    throw new Error("Office native services unavailable.");
  }
  const injector: Injector = captured;
  injector.get(UserManagerService).setCurrentUser({ userID: user.id, name: user.name });
  const activity = nativeActivity(native.univerAPI, injector);
  native.univer.onDispose(() => activity.dispose());
  return { ...native, injector, activity };
}
export type NativeApplication = ReturnType<typeof createNativeApplication>;

export async function loadNativeView(native: NativeApplication, input: FrameInit) {
  const { view } = input;
  const unitId = view.nativeTarget.unitId;
  if (view.nativeTarget.kind === "pinned-snapshot") {
    const snapshots = native.injector.get(SnapshotService);
    if (view.kind === "sheet") await snapshots.loadSheet(unitId, view.revision);
    else if (view.kind === "doc") await snapshots.loadDoc(unitId, view.revision);
    else await snapshots.loadSlide(unitId, view.revision);
    if (native.injector.get(RevisionService).getCurrentRevOfUnit(unitId) !== view.revision)
      throw new Error("Pinned native revision does not match the exact view.");
    return;
  }
  const collaboration = native.univerAPI.getCollaboration();
  const unit =
    view.kind === "sheet"
      ? await collaboration.loadSheetAsync(unitId)
      : view.kind === "doc"
        ? await collaboration.loadDocAsync(unitId)
        : await collaboration.loadSlideAsync(unitId);
  if (unit === null) throw new Error("Office native content unavailable.");
}
