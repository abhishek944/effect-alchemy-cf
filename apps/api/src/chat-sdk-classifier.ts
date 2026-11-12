import { classify } from "@abhishek944/pi-classifier";
import { Type } from "@earendil-works/pi-ai";
import { Schema } from "effect";
import { classifierConfig, gatewayClassifierSettings } from "./chat-gateway-classifier.ts";
import { sdkToolText, type ChatSdkTool, type ChatToolScope } from "./chat-sdk-tool.ts";

const Question = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("bool"),
    instructions: Schema.String,
    criteria: Schema.optionalKey(
      Schema.Struct({
        true: Schema.optionalKey(Schema.String),
        false: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    instructions: Schema.String,
    criteria: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    instructions: Schema.String,
    criteria: Schema.Array(Schema.String),
  }),
]);
const Input = Schema.Struct({
  state: Schema.Union([
    Schema.String,
    Schema.Record(Schema.String, Schema.Json),
    Schema.Array(Schema.Json),
  ]),
  questions: Schema.Record(Schema.String, Question),
});
const common = { instructions: Type.String() };
const parameters = Type.Object(
  {
    state: Type.Union([
      Type.String(),
      Type.Record(Type.String(), Type.Unknown()),
      Type.Array(Type.Unknown()),
    ]),
    questions: Type.Record(
      Type.String(),
      Type.Union([
        Type.Object(
          {
            type: Type.Literal("bool"),
            ...common,
            criteria: Type.Optional(
              Type.Object(
                {
                  true: Type.Optional(Type.String()),
                  false: Type.Optional(Type.String()),
                },
                { additionalProperties: false },
              ),
            ),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("choice"),
            ...common,
            criteria: Type.Record(Type.String(), Type.String()),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          { type: Type.Literal("score"), ...common, criteria: Type.Array(Type.String()) },
          { additionalProperties: false },
        ),
      ]),
    ),
  },
  { additionalProperties: false },
);

/** Runs only behind dispatchSdkTool's accepted assistant lineage and one-call fence. */
export const createChatSdkClassifier = (
  env: Readonly<Record<string, unknown>>,
  assertLive: (scope: ChatToolScope) => void,
): readonly ChatSdkTool[] =>
  classifierConfig(env) === null
    ? []
    : [
        {
          name: "classify",
          description:
            "Ask typed bool, choice or score questions about supplied text or JSON. Uses one server-configured decision model, never chat emulation. No images, file access, provider/model overrides, comparisons or fallback. Low confidence and refusal are valid results, not reasons to retry. Failed or cancelled work may still be billable; do not repeat it automatically.",
          parameters,
          async execute(input, scope) {
            try {
              assertLive(scope);
              const params = Schema.decodeUnknownSync(Input, { onExcessProperty: "error" })(input);
              const settings = gatewayClassifierSettings(env, scope.ownerId, scope.chatId);
              assertLive(scope);
              const result = await classify(params, {
                settings,
                cwd: process.cwd(),
                signal: scope.signal,
                credentialSource: "explicit",
              });
              assertLive(scope);
              return sdkToolText(result);
            } catch {
              return sdkToolText(
                {
                  error:
                    "Classification did not complete. Its charge may be unknown; no fallback or automatic retry was made.",
                },
                true,
              );
            }
          },
        },
      ];
