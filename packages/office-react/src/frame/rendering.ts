import { LifecycleService, LifecycleStages, type Injector } from "@univerjs/core";
import { DocSkeletonManagerService } from "@univerjs/docs";
import { IRenderManagerService } from "@univerjs/engine-render";
import { filter, firstValueFrom, timeout } from "rxjs";
import type { Kind } from "@starter/office-contract";

/** A loaded model or empty canvas is not evidence that the native result is laid out. */
export async function confirmNativeRendering(injector: Injector, kind: Kind, unitId: string) {
  await injector.get(LifecycleService).onStage(LifecycleStages.Rendered);
  const render = injector.get(IRenderManagerService).getRenderUnitById(unitId);
  if (render === undefined || render === null || render.isDisposed())
    throw new Error("Native result renderer unavailable.");
  if (kind === "doc") {
    const layout = render.with(DocSkeletonManagerService);
    await firstValueFrom(
      layout.currentSkeleton$.pipe(
        filter(
          (skeleton) =>
            skeleton !== null &&
            skeleton !== undefined &&
            skeleton.hasCompleteLayout() &&
            (skeleton.getSkeletonData()?.pages.length ?? 0) > 0,
        ),
        timeout({ first: 30_000 }),
      ),
    );
  }
  await document.fonts.ready;
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
