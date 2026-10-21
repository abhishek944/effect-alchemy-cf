import { officeImageReference } from "./office-image.ts";
import { OFFICE_LIMITS, decodeWireSync } from "@starter/office-contract";
import { HostPolicy } from "@starter/office-server/native-remote";

/** Configuration only. Actual image/process/private-binding/SDK readiness is verified separately. */
export function officeHostPolicy(imageRef: string, stage: string): typeof HostPolicy.Type {
  if (!officeImageReference(imageRef, stage))
    throw new Error("Office requires the actual immutable application image reference");
  return decodeWireSync(HostPolicy)({
    version: "office-native-content-v1",
    sdkVersion: "1.0.3",
    imageDigest: imageRef.slice(imageRef.lastIndexOf("@") + 1),
    limits: OFFICE_LIMITS,
  });
}
