import { nativeValueDigest } from "@starter/office-server/native-remote";
import type { HostNativeProducer } from "@starter/office-server/native-remote";
import type {
  NativeFence,
  NativeValueHeader,
  NativeValueRef,
} from "@starter/office-cloudflare/native";
import type { OfficeHeldTurn } from "./office-private-turns.ts";
import type { OfficeEditorHeld } from "./office-editor-grants.ts";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";

type Producer = typeof HostNativeProducer.Type;
/** Data proofs only. Caller has ALREADY proved original process, member and first permit ACK. */
export function officeNativeProducer(
  held: OfficeHeldTurn | OfficeEditorHeld,
  request: OfficePrivateRequest,
  imageDigest: string,
  policyVersion: string,
) {
  const proven = new Map<
    string,
    { readonly header: NativeValueHeader; readonly producer: Producer }
  >();
  const commandId = held.kind === "core" ? held.permit.operationId : held.permit.submissionId;
  return {
    async register(value: NativeValueRef, header: NativeValueHeader, producer: Producer) {
      await request.live();
      const headerType: number | null = header.kind === "block" ? null : header.type;
      if (
        producer.unitID !== held.permit.target.unitId ||
        producer.stepId !== held.permit.stepId ||
        producer.imageDigest !== imageDigest ||
        producer.sdkVersion !== "1.0.3" ||
        producer.policyVersion !== policyVersion ||
        (header.kind !== "block" &&
          (header.unitID !== held.permit.target.unitId ||
            producer.type !== headerType ||
            producer.revision !== header.revision))
      )
        throw officeDenied();
      if (held.kind === "core") {
        if ("kind" in producer || producer.operationId !== held.permit.operationId)
          throw officeDenied();
      } else if (
        !("kind" in producer) ||
        producer.submissionId !== held.permit.submissionId ||
        header.kind !== "changeset" ||
        header.sid !== held.permit.sid ||
        header.reqId !== held.permit.reqId ||
        header.revision !== held.permit.expectedHead + 1
      )
        throw officeDenied();
      const key = await nativeValueDigest(value);
      const previous = proven.get(key);
      const proof = { header: structuredClone(header), producer: structuredClone(producer) };
      if (previous !== undefined && !officeSame(previous, proof)) throw officeDenied();
      if (proven.size >= 8192) throw officeDenied();
      proven.set(key, proof);
    },
    async verify(value: NativeValueRef, header: NativeValueHeader, actual: NativeFence) {
      await request.live();
      const proof = proven.get(await nativeValueDigest(value));
      if (
        proof === undefined ||
        !officeSame(proof.header, header) ||
        actual.commandID !== commandId ||
        actual.stepID !== held.permit.stepId ||
        actual.epoch !== held.permit.authorityEpoch
      )
        throw officeDenied();
    },
    async committed(value: NativeValueRef, producer: Producer) {
      await request.live();
      const proof = proven.get(await nativeValueDigest(value));
      if (
        proof === undefined ||
        !officeSame(proof.producer, producer) ||
        (held.kind === "editor" &&
          (held.leaf === null || !officeSame(held.leaf.committed.value, value)))
      )
        throw officeDenied();
    },
  };
}
