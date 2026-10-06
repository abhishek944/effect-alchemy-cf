import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import { Layer } from "effect";
import { Auth } from "./auth.ts";
import { AuthDatabase } from "./database.ts";

export const AuthLive = Auth.layer.pipe(Layer.provide(CloudflareD1(AuthDatabase)));
