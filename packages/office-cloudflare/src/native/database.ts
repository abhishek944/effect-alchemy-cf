import { withCause } from "@starter/diagnostics";
import type { D1DatabaseSession, D1PreparedStatement } from "@cloudflare/workers-types";
import { prepareNativePublication } from "./prepared-publication.ts";
import {
  assertNativeAdmission,
  captureNativeAdmission,
  capturedAdmissionFence,
  nativeWriteBasis,
  publicationStatements,
} from "./admission-fence.ts";
import { assertReadEpoch, validateNativeAccess } from "./read-access.ts";
import { digest, metadata, NativeStorageError } from "./types.ts";
import type {
  NativeFence,
  NativeAdmission,
  NativeValueRef,
  NativeReadAccess,
  NativeResources,
  NativeScope,
  NativePublicationPreparation,
} from "./types.ts";

export type NativeStatement = readonly [sql: string, bindings: readonly (string | number | null)[]];
export class NativeDatabase {
  readonly scope: NativeScope;
  readonly key: string;
  readonly resources: NativeResources;
  readonly session: D1DatabaseSession;
  readonly admission: NativeAdmission | undefined;
  private writeFence: NativeFence | undefined;
  private readonly readAccess: NativeReadAccess | undefined;
  private readonly preparePublication: NativePublicationPreparation | undefined;
  get fence(): NativeFence {
    this.assertWritable();
    if (!this.writeFence) throw new NativeStorageError("READ_ONLY", "No native write permit");
    return this.writeFence;
  }
  set fence(value: NativeFence) {
    this.assertWritable();
    this.writeFence = value;
  }
  private disposed = false;
  constructor(
    resources: NativeResources,
    scope: NativeScope,
    access: NativeFence | NativeReadAccess,
    preparePublication?: NativePublicationPreparation,
    admission?: NativeAdmission,
  ) {
    if (admission && (!("commandID" in access) || typeof preparePublication !== "function"))
      throw new NativeStorageError("SCOPE", "Strict native writer requires preparation");
    this.admission = admission ? captureNativeAdmission(admission) : undefined;
    this.preparePublication = preparePublication;
    validateNativeAccess(scope, access);
    this.scope = Object.freeze({ ...scope });
    this.key = metadata([scope.stage, scope.ownerID, scope.documentID, scope.unitID]);
    this.writeFence = "commandID" in access ? structuredClone(access) : undefined;
    this.readAccess = "commandID" in access ? undefined : structuredClone(access);
    this.resources = resources;
    this.session = resources.database.withSession("first-primary");
  }
  check(userID?: string, unitID: string = this.scope.unitID): void {
    if (this.disposed) throw new NativeStorageError("DISPOSED", "Native invocation disposed");
    if (unitID !== this.scope.unitID || (userID !== undefined && userID !== this.scope.ownerID)) {
      throw new NativeStorageError("SCOPE", "Native scope mismatch");
    }
  }
  checkReadWorktree(id: string): void {
    if (this.readAccess && this.readAccess.draft?.worktreeID !== id)
      throw new NativeStorageError("SCOPE", "Native read handle belongs to another Worktree");
  }
  assertWritable(): void {
    this.check();
    if (!this.writeFence)
      throw new NativeStorageError("READ_ONLY", "Native reader cannot mutate or stage content");
  }
  get readGrant(): NativeReadAccess | undefined {
    return this.readAccess;
  }
  async assertReadable(): Promise<void> {
    this.check();
    if (this.readAccess) await assertReadEpoch(this.resources, this.key, this.readAccess);
    if (this.admission) await assertNativeAdmission(this, "read");
    this.check();
  }
  async assertWriteAdmission(): Promise<void> {
    this.assertWritable();
    await assertNativeAdmission(this, "stage");
    this.assertWritable();
  }
  dispose(): void {
    this.disposed = true;
  }
  statement(sql: string, bindings: readonly (string | number | null)[] = []): D1PreparedStatement {
    this.check();
    return this.session.prepare(sql).bind(...bindings);
  }
  async first<T>(
    sql: string,
    bindings: readonly (string | number | null)[] = [],
  ): Promise<T | null> {
    await this.assertReadable();
    const result = await this.resources.database
      .withSession("first-primary")
      .prepare(sql)
      .bind(...bindings)
      .first<T>();
    await this.assertReadable();
    return result;
  }
  async all<T>(sql: string, bindings: readonly (string | number | null)[] = []): Promise<T[]> {
    await this.assertReadable();
    const result = (
      await this.resources.database
        .withSession("first-primary")
        .prepare(sql)
        .bind(...bindings)
        .all<T>()
    ).results;
    await this.assertReadable();
    return result;
  }
  async write(
    action: string,
    identity: unknown,
    statements: readonly NativeStatement[],
    predicate = "1",
    values: readonly (string | number | null)[] = [],
    publicationInput: boolean | NativeValueRef = true,
  ): Promise<boolean> {
    const publication = publicationInput !== false;
    const acceptedValue = typeof publicationInput === "boolean" ? undefined : publicationInput;
    await this.assertWriteAdmission();
    const fence = this.fence;
    const { commandID, stepID } = fence;
    const fingerprint = await digest(new TextEncoder().encode(metadata(identity, 512 * 1024)));
    const previous = publication
      ? await this.first<{ fingerprint: string }>(
          `SELECT fingerprint FROM office_native_receipts WHERE scope=? AND command_id=? AND step_id=? AND action=?`,
          [this.key, commandID, stepID, action],
        )
      : null;
    if (publication && previous) {
      if (previous.fingerprint !== fingerprint)
        throw new NativeStorageError("CONFLICT", "Native step input changed");
      return false;
    }
    const { conditions, bindings } = nativeWriteBasis(this.key, fence);
    const associated: NativeStatement[] = [];
    if (publication && this.preparePublication) {
      const prepared = await prepareNativePublication(
        this.preparePublication,
        this.key,
        fence,
        action,
        fingerprint,
        this.admission,
        acceptedValue,
      );
      associated.push(...prepared.statements);
      conditions.push(prepared.condition);
      bindings.push(...prepared.values);
    }
    if (this.admission) {
      const required = capturedAdmissionFence(this, "stage");
      conditions.push(`(${required.sql})`);
      bindings.push(...required.values);
    }
    conditions.push(`(${predicate})`);
    bindings.push(...values);
    const token = crypto.randomUUID();
    const batch = [
      this.statement(
        `INSERT INTO office_native_guard(token,ok) VALUES(?,CASE WHEN ${conditions.join(" AND ")} THEN 1 ELSE 0 END)`,
        [token, ...bindings],
      ),
      ...[...statements, ...associated].map(([sql, args]) => this.statement(sql, args)),
      ...(publication ? publicationStatements(this, action, fingerprint, fence) : []),
      this.statement("DELETE FROM office_native_guard WHERE token=?", [token]),
    ];
    try {
      await this.session.batch(batch);
      return true;
    } catch (cause) {
      if (String(cause).includes("office_native_fence")) {
        throw withCause(
          new NativeStorageError(
            "FENCE",
            "Native authority, head or lifecycle changed; no publication occurred",
          ),
          cause,
        );
      }
      throw cause;
    }
  }
}
