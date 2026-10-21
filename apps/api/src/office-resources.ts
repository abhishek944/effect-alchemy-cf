import type * as Cloudflare from "alchemy/Cloudflare";
import { Context } from "effect";

/** Stack-owned resource references, not credentials or an authorization/storage facade. */
export class OfficeStorage extends Context.Service<
  OfficeStorage,
  {
    readonly database: Cloudflare.D1.Database;
    readonly bucket: Cloudflare.R2.Bucket;
  }
>()("starter/OfficeStorage") {}
