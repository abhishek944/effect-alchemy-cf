import { Schema } from "effect";
import {
  HostControl,
  HostTurn,
  HostNativeHandles,
  HostMetadata,
  HostNativeReads,
  HostNativeWrites,
  HostWorktreeWrites,
  HostNativePieces,
  HostEditor,
  HostBytes,
} from "@starter/office-server/native-remote";
import {
  NativeChannelMember,
  NativeChannelSubmission,
} from "../../office/src/native-private-wire.ts";

// Finite wire classification only. A decoded schema never grants caller/provider authority.
export const metadataRequest = Schema.Union(
  Object.values(HostMetadata).map((method) => method.request),
);
export const readRequest = Schema.Union(
  Object.values(HostNativeReads).map((method) => method.request),
);
export const writeRequest = Schema.Union(
  [...Object.values(HostNativeWrites), ...Object.values(HostWorktreeWrites)].map(
    (method) => method.request,
  ),
);
export const editorRequest = Schema.Union(
  Object.values(HostEditor).map((method) => method.request),
);
const control = [
  ...Object.values(HostControl),
  ...Object.values(HostTurn),
  ...Object.values(HostNativeHandles),
];
export const controlRequest = Schema.Union(control.map((method) => method.request));
const all = [
  ...control,
  ...Object.values(HostMetadata),
  ...Object.values(HostNativeReads),
  ...Object.values(HostNativeWrites),
  ...Object.values(HostWorktreeWrites),
  ...Object.values(HostEditor),
  HostNativePieces.register,
  NativeChannelMember,
  NativeChannelSubmission,
  HostBytes.removeUnreachable,
];
export const OfficePrivateCall = Schema.Union(all.map((method) => method.request));
export const OfficePrivateReply = Schema.Union(all.map((method) => method.response));
export const cleanupMethods = new Set([
  "native.close",
  "turn.release",
  "editor.release",
  "editor.revoke",
]);
