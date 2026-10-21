import { Injector, Plugin, setDependencies } from "@univerjs/core";

/** Capture through the documented plugin injection seam, not __getInjector/private fields. */
export class OfficeFramePlugin extends Plugin {
  static override pluginName = "OFFICE_FRAME";
  protected readonly ["_injector"]: Injector;
  constructor(capture: (injector: Injector) => void, injector: Injector) {
    super();
    this["_injector"] = injector;
    capture(injector);
  }
}
setDependencies(OfficeFramePlugin, [Injector], 1);
