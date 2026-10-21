import { Effect } from "effect";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { VerifiedCoordinatorContext } from "@starter/office-cloudflare/coordinator-control";
import type { OfficeMetadata, NativeTarget } from "@starter/office-server/ports";
import { officeDenied, type OfficePrivateRequest } from "./office-private-authority.ts";
import { officeCoreOrigin } from "./office-core-origin.ts";

/** Scalar correlation only; actual private platform/session verification precedes use. */
export async function officePrivateDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > 16 * 1024) throw officeDenied();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function officePrivatePlacement(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  nodeId: string,
  request: OfficePrivateRequest,
) {
  return async (documentId: string) => {
    await request.live();
    const owner = request.original.actor.owner;
    if (options.stage !== owner.stage) throw officeDenied();
    const record = await Effect.runPromise(metadata.document(owner, documentId));
    if (record === null) throw officeDenied();
    // Actual same-process hosting lease, renewed independently of (never extending) this Actor.
    const current = await request.currentPlacement(documentId);
    if (
      current.nodeId !== nodeId ||
      current.state !== "live" ||
      current.until <= Date.now() ||
      current.unitId !== record.unitId
    )
      throw officeDenied();
    return current;
  };
}
export async function officeCoreContext(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  nodeId: string,
  request: OfficePrivateRequest,
  target: NativeTarget,
  operationId: string,
  purpose: "native" | "metadata" | "proof",
): Promise<Extract<VerifiedCoordinatorContext, { kind: "core" }>> {
  const original = await officeCoreOrigin(metadata, request, target, operationId, purpose);
  const placement = await officePrivatePlacement(
    options,
    metadata,
    nodeId,
    request,
  )(target.documentId);
  return {
    kind: "core",
    target,
    binding: original.binding,
    document: { owner: target.owner, documentId: target.documentId, unitId: target.unitId },
    placementId: placement.id,
    purpose,
    authorizationDigest: await officePrivateDigest([
      "office-core",
      1,
      nodeId,
      request.original.actor,
      operationId,
      ...original.basis,
    ]),
    notAfter: Math.min(original.notAfter, placement.until),
  };
}
