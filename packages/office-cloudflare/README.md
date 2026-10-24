# Office Cloudflare native storage

`@starter/office-cloudflare/native` implements the **public 1.0.3** asynchronous
`IDatabaseAdapter` and `IWorktreeDatabaseAdapter`. It imports SDK **types only**;
no Node SDK service, native addon, application ports or neighboring checkout enters
its Worker graph. SDK services still own validation, OT, materialization and merge.

## Trusted composition

```ts
import { createNativeStorage, initializeNativeSchema } from "@starter/office-cloudflare/native";

await initializeNativeSchema(env.OFFICE_D1);
const store = createNativeStorage(
  { database: env.OFFICE_D1, bucket: env.OFFICE_R2 },
  { stage, ownerID, documentID, unitID },
);
const admitted = { epoch: 1, commandID, stepID };
await store.compareAuthority(null, admitted); // Check the returned CAS boolean.
const native = store.invocation({ ...admitted, main: null });
// Supply native.database / native.worktrees to the trusted SDK broker.
// After service shutdown:
await native.dispose();
```

Scope is captured from authenticated host composition, never SDK request fields.
`DatabaseContext.userID` must match that owner. `request` and `customData` are never
serialized, logged or stored. A factory owns exactly one document/native Unit;
a Worktree owns at most that one Unit. Multi-document lifecycle calls are rejected.

`compareAuthority(expected, next): Promise<boolean>` atomically changes the native
admission row. New runtime ownership must **increase** epoch; command/step changes
CAS the complete previous tuple. Command and step must both be present or absent.
Never reuse a completed command/step identity for different native input. This is
trusted coordinator capability, not an endpoint for browser/generated code.

`invocation(fence)` captures main head/lifecycle (or absence) and, for existing
Worktree mutations, exact `{ worktreeID, generation, status, head, removed }`.
Head `0` represents empty Worktree membership. Creation binds generation `1`;
reopen increments it even when heads do not move. The invocation advances its own
expected vector only after its accepted writes. Use one admitted SDK operation per
invocation. Keep the SDK service turn serialized by the document coordinator;
these adapters are storage CAS, not the coordinator's queue or authentication.

For views/inspection/protocol reads, acquire
`await store.readInvocation({ epoch, draft?: { worktreeID, generation } })`.
A fresh primary read validates native authority, allocating **no** command/step/write
grant. Only upstream `database`, `worktrees` and `dispose` escape. All 17 mutation
methods reject `READ_ONLY` before arguments; R2 staging is denied internally.
Reads revalidate epoch/generation around D1 reads and after R2 loading; dispose
invalidates the handle. Private brokers may acquire `await store.readReferences(access)`
for metadata `reads`, bounded `loadPiece(origin,ref)` and `dispose`, without writes
or staging and under the SAME read epoch/Worktree fence. Keep helpers private;
application `OpenNative` returns only upstream interfaces. Node additionally checks
its real service epoch; no application ports or invented epoch state enter here.
Epoch invalidation cannot retract returned bytes. Piece loads check exact published
snapshot/seed/Ready-artifact/changeset membership before and after R2 loading;
completed/staging bytes alone grant nothing. Draft grants cap BOTH SDK and ref-only
main reads at their actual trunk baseline; newer main needs separate authorization.
`@starter/office-cloudflare/native-doc-read` exports `createDocReadSession` for finite
main-Doc control/piece reads. It requires matching native scope, live authorization,
original signal, revision ceiling, private association, budgets and awaited disposal.
This source-only adapter mounts no host and supplies no session/View/placement
authority. The historical standalone Node peer and readonly host have been retired.

## Atomic publication and recovery

Every authoritative mutation uses a D1 batch with a named failing CHECK guard,
expected vector, native indexes/head, step receipt and outbox. The guard aborts
**all** statements; a zero-row CAS cannot publish history/receipt/outbox. The
core/draft CAS facade returns the SDK revision-mismatch result when another head
won; an obsolete authority or unchanged-head vector mismatch throws
`NativeStorageError("FENCE", ...)`. A repeated native `(branch,sid,reqId)` with
identical bytes returns its historical accepted revision; changed bytes conflict.

Each index/authority read starts a fresh `first-primary` D1 session. History is ordered,
continuous and fails on gaps/missing content. `references.reads.submission`,
`receipt` and paged `outbox` expose durable identities without scanning content.
Incomplete/budget-limited history is never proof of noncommit. No source replay.
The receipt key is `(scope,command_id,step_id,action)`; fingerprint hashes normalized
metadata/ref identity, and epoch is the ORIGINAL accepted write epoch. It is not
an operation digest or ArtifactRef digest. The bridge exposes a finite semantic key,
not arbitrary action strings or old-generation/staged byte access.

Production requires the trusted factory hook `beforePublication(binding,fence)`.
It receives `{action,fingerprint,authorityEpoch}` AFTER normalized identity hashing,
before publication; it awaits `metadata.prepareWrite` with the already-staged actual
journal and returns only `{writeId,payloadDigest}`. The FINAL native D1 guard also
checks the exact enabled `office_native_prepared_slots` tuple and original epoch.
Callback ACK alone cannot publish. Existing receipt/duplicate fast paths never
manufacture preparation; both normal ACK and recovery require its saved binding.
SDK-only direct probes can omit journal mode; production composition MUST NOT.

Ready freezes the current draft head; only draft accepts changes. Removal blocks
writes but does not delete trunk. Reopen invalidates old vectors. Discard leaves
main unchanged. Merge artifacts are immutable per Ready revision; terminal merge
results cannot change. Conflicts/failures remain resumable in merging. Finishing
requires every Unit result to be merged/unchanged/removed. No custom merge algorithm.
Soft-delete hides native content and is recoverable. Hard-delete retains a permanent
inaccessible tombstone; no reuse or physical-erasure promise. Dispose prevents new
calls and does not close caller-owned bindings; revoke authority before shutdown
when in-flight writes must also be prevented.

The coordinator must consume exact human approval/install its durable barrier in
**the same D1 database** before admitting merge. All native writes then check that
admitted epoch/command/step and exact approved head/vector. This package does not
invent application approval tables or claim an R2+D1+DO transaction.

## Immutable bytes and large native inputs

R2 holds versioned MessagePack native snapshots, blocks and changesets. The thin
storage codec delegates to `@starter/office-contract/native-wire`: format
`office-native-msgpack`, version `1`, explicit undefined extension `1`; value refs
use `codec: "office-native-msgpack-v1"`. Known snapshot/block/changeset kinds are
required on encode/decode. Node uses the SAME portable codec without importing
this Cloudflare package. R2 manifests are bounded canonical JSON **refs only**,
not native content or a workbook JSON backup. Old experimental ext42 artifacts
are deliberately unsupported; no released/prod format/data is being migrated.

Explicit undefined, binary Uint8Array/Buffer byte contents and negative zero survive.
Holes, cycles, accessors, arbitrary classes, symbols, functions, bigint, nonfinite
numbers, malformed strings/keys/extensions and excessive decoded depth are rejected.
Shared initial bounds include depth 64, one million nodes, 8 MiB strings, 100,000
array entries and 50,000 map entries. SDK mutation `data` strings remain opaque.

`references.payloads.stagePiece(Uint8Array): Promise<NativePieceRef>` hashes and
conditionally writes a complete immutable piece, then fences its D1 completion
index. Keys isolate stage/owner/document/Unit and include SHA-256. Pieces are at
most 4 MiB. `loadPiece` verifies length and digest. Missing content is an error,
never a blank replacement. Do not delete completed pieces while manifests reference
them; completion indexes rely on immutable retention. Cleanup needs reachability,
leases and a grace period, including unpublished index pages and uncertain writes.

For large inputs the trusted **Node broker** encodes native values using
`encodeNativeFrame(kind, value)` from the portable native-wire export, splits each encoded value into canonical 4 MiB pieces
(only the last may be smaller), and stages them in separate bounded broker calls.
It builds `NativeValueRef` and `NativeSnapshotRefs` from validated SDK output.
Before refs can publish, call `references.payloads.registerValue(value,header)`.
This requires trusted factory `verifyProducer(value,header,fence): Promise<void>`
to verify the authenticated owning SDK producer's exact manifest/header/invocation;
missing verification denies registration. Local typed staging validates the real
protocol metadata directly. Immutable value fingerprints bind finite Unit/type/
revision/block/submission headers, and publication checks those against its indexes.
Binary originalMeta/block bodies and SDK mutation semantics remain SDK-owned.
Validate represented SDK 1.0.3 envelope/identity headers, not a replacement content
model: real sparse Exchange and `createUnitFromData` snapshots both persist without
adding defaults or dropping native extension fields. Omitted worksheet type, block
sheetID/Doc creator/Slide resources and extra Slide id retain exact wire bytes.
No guessed defaults, unchecked SDK casts or production producer authentication are supplied here.
Then use:

- `references.core.createUnit(record, refs)` and `saveSnapshot(refs)`;
- `references.core.commitChangeset(ref)` returns refs, not decoded changesets;
- `references.worktree.createUnit(unit, refs)`;
- `references.worktree.saveUnitMergeArtifact(worktreeID, readyRevision, refs)`;
- `references.worktree.commitDraftChangeset(worktreeID, ref)`.

These are native typed operations, not generic SQL RPC. Ref DTO identity/type/revision
and complete block membership must be derived by the trusted SDK/broker, never
accepted directly from generated output. The native facade validates block
completeness against the snapshot. Ref calls verify scoped staged pieces, kinds,
lengths and limits without decoding content. `references.reads.snapshot`, `seed`,
`mergeArtifact` and paged `changesets` return bounded metadata for Node loading.
The SDK facade necessarily materializes values and accepts at most 32 Sheet blocks
per Worker call; larger imports **must** use the reference path.

Snapshot block indexes stage in pages of 32 below an unpublished manifest identity.
Each staging batch has 3 statements; at most 128 pages cover 4,096 blocks. A final
create publication batch has **8 statements** regardless of block count. Current
native operations use at most 28 bindings in any statement including preparation. Unpublished indexes cannot be read as native blocks.
Final completeness/immutable-block checks and snapshot/head/receipt/outbox share
that batch. Losing publication may leave only unreachable R2 bytes/staging indexes.

Hard limits: 128 MiB encoded native aggregate, 4,096 blocks, 8 MiB block data,
2 MiB reference manifest, 16 KiB operation metadata, 128 history/outbox refs per
page. Canonical chunking bounds manifest fan-out. This large-reference profile
requires a paid Worker/D1 allowance of 1,000 queries per invocation; it is **not**
a free-tier capacity claim. Staging, R2 hashing and SDK loading are separate bounded
calls; runtime memory/CPU/transport admission may impose smaller limits. These are
admission ceilings, not measured document/editor capacity.

## Schema and checks

The native initializer creates only `office_native_*` tables. Version 2 adds validated value provenance
and provider-private prepared publication slots, initializes additively and
rejects an incompatible existing version; there are no auth/chat migrations,
drops or resets. Bindings and schema initialization remain host-owned.

Non-unit verification and actual isolated local Alchemy/workerd results are in
`var/office/implement-details/native-storage-result.md`. They do not establish
cloud deployment, host approval/authentication, live editor transport, large native
semantic merge or production capacity. No unit tests or cloud operations are needed
for this package's scoped type/build checks.

## Office metadata

`@starter/office-cloudflare/metadata` exports `createOfficeMetadata(options)` and
`initializeOfficeMetadataSchema(database)` for the same Office D1/R2. Its sole
initializer composes catalog, journal, review, View/editor, job and byte DDL.
Host owns stage/worker identity and native schema setup; see [trusted control](COORDINATOR.md).
