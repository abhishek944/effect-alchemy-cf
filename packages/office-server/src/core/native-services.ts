import { UniverCollabService } from "@univerjs-pro/collaboration-service";
import {
  UniverCollabWorktreeService,
  type BaseWorktreeMiddlewareContext,
} from "@univerjs-pro/collaboration-worktree-service";
import type { OfficeLimits } from "@starter/office-contract";
import { createCoreDispatch, createWorktreeDispatch } from "./native-dispatch.ts";
import type { NativeLeaseContext } from "./native-lease.ts";
import { checkNativePermissions } from "./native-policy.ts";
import { officeFailure } from "./failure.ts";

export type NativeServices = {
  readonly core: UniverCollabService;
  readonly drafts: UniverCollabWorktreeService;
};
export function createNativeServices(
  context: NativeLeaseContext,
  limits: OfficeLimits,
): NativeServices {
  const coreAdapter = createCoreDispatch(context);
  const options = {
    maxLoadedUnits: limits.cachedUnits,
    idleTimeoutMs: limits.cacheTtlSeconds * 1000,
  };
  const core = new UniverCollabService({
    dbAdapter: coreAdapter,
    snapshotPolicy: false,
    enableUnitPermissionAnalysis: true,
    runtime: options,
    submitChangeset: { maxRevisionRetries: 0 },
  });
  const drafts = new UniverCollabWorktreeService({
    trunk: { service: core, dbAdapter: coreAdapter },
    dbAdapter: createWorktreeDispatch(context),
    enableUnitPermissionAnalysis: true,
    runtime: options,
    submitChangeset: { maxRevisionRetries: 0 },
  });
  core.use("readUnitData", async (ctx, next) => {
    context.current(ctx.userID, ctx.request.unitID);
    await next();
  });
  core.use("createUnit", async (ctx, next) => {
    context.current(ctx.userID, ctx.request.snapshot.unitID);
    context.assertWrite(ctx.userID, "core-create");
    await next();
  });
  core.use("deleteUnits", () => {
    throw officeFailure("FORBIDDEN");
  });
  core.use("recoverUnits", () => {
    throw officeFailure("FORBIDDEN");
  });
  core.use("submitChangeset", async (ctx, next) => {
    context.current(ctx.userID, ctx.request.changeset.unitID);
    context.assertWrite(ctx.userID, "core-commit");
    await next();
  });
  core.use("commitChangeset", async (ctx, next) => {
    context.current(ctx.userID, ctx.changeset.unitID);
    context.assertWrite(ctx.userID, "core-commit");
    checkNativePermissions(ctx.requiredUnitPermissions, context.target.unitId, ctx.changeset.type);
    await next();
  });
  drafts.use("readWorktreeData", async (ctx, next) => {
    context.current(ctx.userID, undefined, ctx.request.worktreeID);
    await next();
  });
  drafts.use("readUnitData", async (ctx, next) => {
    context.current(ctx.userID, ctx.request.unitID, ctx.request.worktreeID);
    await next();
  });
  drafts.use("submitChangeset", async (ctx, next) => {
    context.current(ctx.userID, ctx.request.changeset.unitID, ctx.request.worktreeID);
    context.assertWrite(ctx.userID, "draft-commit");
    await next();
  });
  drafts.use("commitChangeset", async (ctx, next) => {
    context.current(ctx.userID, ctx.changeset.unitID, ctx.request.worktreeID);
    context.assertWrite(ctx.userID, "draft-commit");
    checkNativePermissions(ctx.requiredUnitPermissions, context.target.unitId, ctx.changeset.type);
    await next();
  });
  drafts.use("createWorktree", async (ctx, next) => {
    context.current(ctx.userID, undefined, ctx.request.worktreeID);
    if (
      ctx.request.units.length > 1 ||
      ctx.request.units.some((id) => id !== context.target.unitId)
    )
      throw officeFailure("FORBIDDEN");
    context.assertWrite(ctx.userID, "worktree-create");
    await next();
  });
  drafts.use("addWorktreeUnit", async (ctx, next) => {
    context.current(ctx.userID, ctx.request.unitID, ctx.request.worktreeID);
    context.assertWrite(ctx.userID, "worktree-add");
    await next();
  });
  drafts.use("createWorktreeUnit", async (ctx, next) => {
    context.current(ctx.userID, ctx.request.snapshot.unitID, ctx.request.worktreeID);
    context.assertWrite(ctx.userID, "draft-create");
    await next();
  });
  drafts.use("setWorktreeUnitRemoved", () => {
    throw officeFailure("FORBIDDEN");
  });
  for (const [method, action] of [
    ["markWorktreeReady", "markReady"],
    ["reopenWorktree", "reopenWorktree"],
    ["discardWorktree", "discardWorktree"],
    ["mergeWorktree", "startOrResumeMerge"],
  ] as const) {
    drafts.use(
      method,
      async (
        ctx: BaseWorktreeMiddlewareContext & { readonly request: { readonly worktreeID: string } },
        next: () => Promise<void>,
      ) => {
        context.current(ctx.userID, undefined, ctx.request.worktreeID);
        context.assertWrite(ctx.userID, "worktree-transition", action);
        await next();
      },
    );
  }
  return { core, drafts };
}
