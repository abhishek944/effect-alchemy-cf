import { withDiagnostic } from "@starter/diagnostics";
import { Config, type Context, Effect, Schema } from "effect";
import { type ChatNamespaces, doCall } from "./chat-bindings.ts";
import { OperationReceipt } from "./chat-contract.ts";
import { ignoreReport, privateUnavailable } from "./chat-diagnostics.ts";
import { requireOwnedChat } from "./chat-http-read.ts";
import {
  AcceptedResponse,
  AdmitDecision,
  FirstInputDecision,
  SendFailure,
  chatHeader,
  decodeOption,
  decodeOrFail,
} from "./chat-internal.ts";
import {
  ChatArchived,
  ChatBusy,
  ChatInvalid,
  ChatRateLimited,
  ChatUnavailable,
  InferenceUnavailable,
  INFERENCE_UNCONFIGURED,
  SUBMISSION_FAILED,
  SubmissionFailed,
  type SendMessage,
} from "./chat-model.ts";
import { CurrentUser } from "./model.ts";
import { sendIdentity } from "./chat-send-identity.ts";
import { publicApplicationOrigin } from "./chat-public-origin.ts";
import { chatOfficeSessionHeaders, CurrentChatOfficeSession } from "./chat-office-session.ts";

export const sendChat = (
  ns: Context.Service.Shape<typeof ChatNamespaces>,
  id: string,
  payload: typeof SendMessage.Type,
) =>
  Effect.gen(function* () {
    if (
      payload.text.length === 0 &&
      payload.attachments.length === 0 &&
      (payload.references?.length ?? 0) === 0 &&
      (payload.referenceInputs?.length ?? 0) === 0
    )
      return yield* Effect.fail(new ChatInvalid({ message: "Write a message or attach a file." }));
    const identity = sendIdentity(payload);
    const user = yield* CurrentUser;
    const chat = yield* requireOwnedChat(ns, user.id, id);
    const applicationOrigin = yield* publicApplicationOrigin;
    if (chat.archived) return yield* Effect.fail(new ChatArchived());
    // Metadata only: an unavailable object cannot fail the accepted message, and
    // the bounded title model call runs in the catalog after this quick claim.
    const claimTitle = () =>
      Effect.gen(function* () {
        if (payload.text.length === 0) return;
        const check = yield* doCall(
          ns.conversation(user.id, chat.id),
          "POST",
          "/title",
          { operationId: payload.operationId },
          chatHeader(chat),
        );
        if (check.status !== 200) return;
        const first = yield* decodeOrFail(FirstInputDecision, check.body);
        if (!first.first) return;
        yield* doCall(
          ns.catalog(user.id),
          "POST",
          "/title/claim",
          {
            id: chat.id,
            operationId: payload.operationId,
            text: payload.text,
            identity,
            selection: payload.selection,
          },
          { "x-chat-owner": user.id },
        );
      }).pipe(
        ignoreReport({ component: "chat", operation: "send.title-claim", reason: "title-claim" }),
      );
    const nativeReceipt = () =>
      doCall(
        ns.conversation(user.id, chat.id),
        "POST",
        "/receipt",
        { operationId: payload.operationId },
        chatHeader(chat),
      ).pipe(
        Effect.flatMap((call) =>
          call.status === 200
            ? decodeOrFail(OperationReceipt, call.body)
            : Effect.fail(privateUnavailable("receipt", call.status)),
        ),
      );
    // Native exact input evidence precedes quota. No answer/result entry is read.
    let nativeAccepted = (yield* nativeReceipt()).accepted;
    const attemptId = crypto.randomUUID();
    const admit = () =>
      doCall(ns.catalog(user.id), "POST", "/admit", {
        operationId: payload.operationId,
        chatId: chat.id,
        identity,
        now: Date.now(),
        nativeAccepted,
        attemptId,
      }).pipe(
        Effect.flatMap((call) =>
          call.status === 200
            ? decodeOrFail(AdmitDecision, call.body)
            : Effect.fail(privateUnavailable("admit", call.status)),
        ),
      );
    if (!nativeAccepted) {
      const gateway = yield* Config.String("CHAT_GATEWAY_ID").pipe(
        Config.withDefault(""),
        Effect.orDie,
      );
      if (gateway.length === 0)
        return yield* Effect.fail(new InferenceUnavailable({ message: INFERENCE_UNCONFIGURED }));
    }
    let decision = yield* admit();
    if (!decision.admitted && decision.reason === "rate" && !nativeAccepted) {
      // One bounded recheck closes acceptance racing the initial lookup/quota decision.
      nativeAccepted = (yield* nativeReceipt()).accepted;
      if (nativeAccepted) decision = yield* admit();
    }
    if (!decision.admitted) {
      if (decision.reason === "mismatch")
        return yield* Effect.fail(
          new ChatInvalid({
            message: "operationId was already used for different content.",
          }),
        );
      if (decision.reason === "archived") return yield* Effect.fail(new ChatArchived());
      return yield* Effect.fail(new ChatRateLimited());
    }
    // Catalog identity is still checked/repaired; native accepted retries never recharge or resubmit.
    if (decision.reason === "duplicate" && !nativeAccepted)
      return yield* Effect.fail(new ChatUnavailable());
    const officeHeaders = chatOfficeSessionHeaders(yield* CurrentChatOfficeSession);
    const call = yield* doCall(ns.conversation(user.id, chat.id), "POST", "/messages", payload, {
      ...chatHeader(chat),
      "x-chat-owner": user.id,
      "x-chat-application-origin": applicationOrigin,
      ...officeHeaders,
    });
    if (call.status === 409 || call.status === 400) {
      yield* doCall(ns.catalog(user.id), "POST", "/release", {
        operationId: payload.operationId,
        attemptId: decision.attemptId,
      }).pipe(ignoreReport({ component: "chat", operation: "send.release", reason: "release" }));
      if (call.status === 400) {
        const failure = decodeOption(
          Schema.Struct({ message: Schema.String.check(Schema.isMaxLength(500)) }),
          call.body,
        );
        return yield* Effect.fail(
          new ChatInvalid({
            message: failure?.message ?? "Check the selected model, effort and files.",
          }),
        );
      }
      if (call.status === 409) {
        const fenced = decodeOption(
          Schema.Struct({
            message: Schema.String.check(Schema.isMaxLength(256)),
            code: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
          }),
          call.body,
        );
        if (fenced?.code === "skills_not_admitted")
          return yield* Effect.fail(new ChatInvalid({ message: fenced.message }));
      }
      return yield* Effect.fail(new ChatBusy());
    }
    if (call.status === 503) {
      const failure = decodeOption(SendFailure, call.body);
      if (failure?.code === "inference_unconfigured")
        return yield* Effect.fail(new InferenceUnavailable({ message: INFERENCE_UNCONFIGURED }));
      return yield* Effect.fail(
        new SubmissionFailed({ message: failure?.message ?? SUBMISSION_FAILED }),
      );
    }
    if (call.status !== 200) return yield* Effect.fail(privateUnavailable("send", call.status));
    const accepted = yield* decodeOrFail(AcceptedResponse, call.body).pipe(
      Effect.mapError((error) => withDiagnostic(error, "send-decode")),
    );
    if (!accepted.accepted) return yield* Effect.fail(new ChatUnavailable());
    yield* claimTitle();
    // A lost finalize is repairable from exact native acceptance on the next retry.
    yield* doCall(ns.catalog(user.id), "POST", "/finalize", {
      operationId: payload.operationId,
      now: Date.now(),
    }).pipe(ignoreReport({ component: "chat", operation: "send.finalize", reason: "finalize" }));
    yield* doCall(ns.catalog(user.id), "POST", "/touch", { id: chat.id }).pipe(
      ignoreReport({ component: "chat", operation: "send.touch", reason: "touch" }),
    );
    return { accepted: true as const };
  });
