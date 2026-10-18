import type * as Cloudflare from "alchemy/Cloudflare";
import { Context } from "effect";

/** Infrastructure supplies one private stage bucket; browser code never imports this. */
export class ChatFilesBucket extends Context.Service<ChatFilesBucket, Cloudflare.R2.Bucket>()(
  "starter/ChatFilesBucket",
) {}
