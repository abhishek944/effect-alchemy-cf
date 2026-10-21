# Office contracts

Browser/Worker-safe Effect 4.0.1 schemas and HTTP client for private Sheets, Docs
and Slides. This package owns finite application boundaries, not SDK content,
OT, storage, authentication, rendering or execution. Native SDK types stay in
`@starter/office-server/ports`. No sibling checkout is a dependency.

## Exports

- `@starter/office-contract`: request/result/error schemas, `OfficeApi`,
  `OfficeCommand`, `decodeWire`/`decodeWireSync`, limits and type aliases.
- `@starter/office-contract/client`: `makeOfficeClient`, `OfficeClient`,
  `uploadOfficeBytes` and `BinaryUpload`.
- `@starter/office-contract/native-wire`: internal bounded MessagePack native
  artifact codec. Do not expose it as a model tool or public document store.

```ts
const client = yield * makeOfficeClient(origin);
const receipt =
  yield *
  client.office.create({
    payload: {
      operationId,
      title: "Budget",
      destination: "new-draft",
      source: { kind: "blank", documentKind: "sheet" },
    },
  });
```

Supply an authenticated Effect HttpClient at composition. Actor/owner comes
from trusted server authentication, never a command field. Clients expose
transport/schema failures alongside declared Office errors. Browser mutations
need the host's exact-Origin protection and private no-store handling.

`OfficeCommand` is a structured task capability, not a shell command. It cannot
approve/merge, revoke a human editor, choose a backend/owner, or create main
content. The full human HTTP client can request approval/merge; server
capability checks remain mandatory. One document belongs to a reviewable draft.

## Native view identity

View.nativeTarget describes actual server-resolved SDK IDs, not authorization:
`main {unitId}`, `draft {unitId,worktreeId,generation}`, or
`pinned-snapshot {unitId}`. Never substitute documentId/draftId for those IDs.
Live views use `/universer-api`; frozen views are read-only and use their exact
`/api/office/views/:viewId/protocol` endpoint with no collaboration socket.
The host binds each opaque view/session to owner, branch, revision and epoch.

## Wire validation

Use `decodeWire(schema)` or `decodeWireSync(schema)` on every untrusted command,
response and stored application record. They reject excess fields recursively.
`OfficeApi` applies the same strict policy to bodies/query/results; headers
retain ordinary transport fields. TypeScript does not authenticate an Actor
or validate SDK mutation semantics.

Operation receipts contain bounded identities/phases/digests/artifact references,
not native content, source code, mutation arrays or file bytes. Inspection and
review are separate bounded content projections. Their full native read-only
views remain distinct from summary metadata. Main/draft/revision/epoch must be
validated server-side even when a client knows the relevant ID.

## Binary transport

`uploadOfficeBytes(origin, input, authenticatedFetch?)` streams a raw PUT to
`/api/office/uploads/:operationId`, counting declared bytes and bounding the
response. Headers carry kind (`upload`/`code`), percent-encoded filename, byte
length and optional source SHA-256. The server must decode the filename once,
validate content/digest, enforce owner/limits, and publish an immutable ref only
after receiving all bytes.

The API's `upload` endpoint intentionally has no JSON body: its native handler
reads the request stream. Use the streaming helper rather than the generated
empty-body method. `artifact` reads metadata; `download` is an Effect streaming
byte response. The host streams through Worker/DO with backpressure and does
not turn file bytes into JSON/base64. Native protocol/101 handling is separate.

## Internal native artifact format

`encodeNativeFrame(kind, payload, limits?)` and
`decodeNativeFrame(bytes, expectedKind, limits?)` use a MessagePack envelope:
`{ format: "office-native-msgpack", version: 1, kind, payload }`.
`NATIVE_WIRE_CODEC` is `office-native-msgpack-v1` for value-reference/job metadata.
Kinds are snapshot/block/changeset/proposal/job-input/job-output/merge-artifact.
Consumers MUST validate owning public SDK DTOs and trusted job/target bindings;
a decoded binary frame is not authorization or a native semantic validator.

Uint8Array stays binary. Explicit undefined uses private extension type 1 with
zero-byte payload, preserving own-undefined versus absent object fields and
dense array entries; null is never substituted. Numbers use float64 so negative
zero survives. Reject holes, functions, bigint, nonfinite values, arbitrary
classes, getters, symbol/nonenumerable record fields, malformed UTF-16,
prototype keys, duplicate wire keys and unknown extensions. Native mutation
`data` strings remain opaque; this codec does not parse/rewrite IDs or params.
SDK snapshot fields explicitly allow undefined; dropping those values is not
a safe generic normalization.

Before decode, a byte scanner bounds lengths/nodes/depth and rejects invalid
maps/extensions/trailing bytes before MessagePack allocates containers. Before
encode, iterative validation rejects unsupported domains/cycles and applies a
conservative encoded-size budget. Encoding is not streaming/out-of-core and can
need both graph and byte buffers; run native jobs within hard resource limits.

Defaults: 128 MiB frame, depth 64, 1,000,000 nodes, arrays 100,000, maps 50,000,
strings 8 MiB, binary field 128 MiB. Explicit ceilings are exported; each SDK
block/file/proposal consumer must also enforce its narrower policy. These are
R2/native artifact budgets, not D1 row limits. D1 operation metadata is <=16 KiB.
`NativeWireError` exposes only fixed INVALID_FRAME/LIMIT_EXCEEDED messages.

## Checks and ownership

`pnpm --dir packages/office-contract exec tsc --noEmit` checks this package.
Scoped formatting and binary artifact/schema verification are allowed; no unit
tests are included. The parent owns manifests, tsconfigs and lockfile. Host
file/tab selection, native services, D1/R2 authority and disposable job isolation
are outside this package. Native editors/reviews mount in the existing right
tools panel, never a new Office home or replacement center chat.
