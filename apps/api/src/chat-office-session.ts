import { withCause } from "@starter/diagnostics";
import { AuthenticationUnavailable } from "./model.ts";
import { Auth } from "@starter/auth";
import { OfficeSessionEpochs, resolveOfficeSession } from "@starter/auth/office-session";
import type { OfficeSessionBinding } from "@starter/auth/office-session";
import { Config, Context, Effect, Option, Schema } from "effect";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Positive = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const Session = Schema.Struct({
  stage: Id,
  ownerId: Id,
  sessionId: Id,
  sessionEpoch: Positive,
  expiresAt: Positive,
});
const header = "x-chat-office-session";

/** Only real authentication middleware provides this optional original association. */
export class CurrentChatOfficeSession extends Context.Service<
  CurrentChatOfficeSession,
  OfficeSessionBinding | null
>()("starter/CurrentChatOfficeSession") {}

/** Capture dependencies during middleware construction, not in the returned Worker fetch effect. */
export const makeChatOfficeSessionCapture = Effect.gen(function* () {
  const auth = yield* Auth;
  const epochs = yield* OfficeSessionEpochs;
  const stage = yield* Config.String("OBS_STAGE").pipe(Config.withDefault(""));
  return (ownerId: string, headers: Headers) =>
    resolveOfficeSession(stage, headers).pipe(
      Effect.provideService(Auth, auth),
      Effect.provideService(OfficeSessionEpochs, epochs),
      Effect.map((original): OfficeSessionBinding | null =>
        original.ownerId !== ownerId || stage.length === 0
          ? null
          : Object.freeze({
              stage: original.stage,
              ownerId: original.ownerId,
              sessionId: original.sessionId,
              sessionEpoch: original.sessionEpoch,
              expiresAt: original.expiresAt,
            }),
      ),
      Effect.catchTag("OfficeSessionDenied", () => Effect.succeed(null)),
      Effect.mapError((cause) => withCause(new AuthenticationUnavailable(), cause)),
    );
});

/** Constructed from actual middleware evidence, never copied from incoming browser headers. */
export const chatOfficeSessionHeaders = (original: OfficeSessionBinding | null) =>
  original === null ? {} : { [header]: encodeURIComponent(JSON.stringify(original)) };

/** Private stored metadata decoding only, never authentication from identifiers/epoch. */
export function decodeChatOfficeSession(raw: string | null): OfficeSessionBinding | null {
  if (raw === null || raw.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const decoded = Option.getOrNull(
      Schema.decodeUnknownOption(Session, { onExcessProperty: "error" })(value),
    );
    return decoded === null ? null : Object.freeze(decoded);
  } catch {
    return null;
  }
}

/** Caller MUST already prove the existing private binding/actual conversation owner association. */
export function chatOfficeSessionFromRequest(
  request: Request,
  ownerId: string,
): OfficeSessionBinding | null {
  const raw = request.headers.get(header);
  if (raw === null || raw.length > 8192) return null;
  try {
    const session = decodeChatOfficeSession(decodeURIComponent(raw));
    return session?.ownerId === ownerId && session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}
