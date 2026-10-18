import type * as cf from "@cloudflare/workers-types";

declare const module: cf.WebAssembly.Module;
export default module;
