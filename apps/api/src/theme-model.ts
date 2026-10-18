/**
 * Account theme schemas: the five existing ids, the revisioned account record,
 * and the frozen command/receipt contracts that make AI theme actions stable.
 *
 * A command is prepared once from the user's own authenticated message, before
 * native admission, and is then immutable: the expected revision, the chosen
 * theme and any Undo target never get rebased from a later read. The catalog
 * stores one terminal receipt per command so a retried or duplicated delivery
 * returns the original outcome instead of applying a second change.
 */
import { Schema } from "effect";

export const THEME_IDS = ["light", "dark", "midnight-black", "dusk", "paper"] as const;
export const ThemeId = Schema.Literals(THEME_IDS);
export type ThemeId = typeof ThemeId.Type;

/** Dark remains the product default. */
export const THEME_DEFAULT: ThemeId = "dark";

export const ThemeRevision = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
);
export type ThemeRevision = typeof ThemeRevision.Type;

const ThemeSource = Schema.Literals(["default", "account"]);
export type ThemeSource = typeof ThemeSource.Type;

export const AccountTheme = Schema.Struct({
  version: Schema.Literal(1),
  revision: ThemeRevision,
  theme: ThemeId,
  source: ThemeSource,
  /** Legacy field from the first draft; always null now that Undo is receipt-scoped. */
  previous: Schema.NullOr(Schema.Struct({ theme: ThemeId, revision: ThemeRevision })),
});
export type AccountTheme = typeof AccountTheme.Type;

export const ThemeView = Schema.Struct({
  theme: ThemeId,
  revision: ThemeRevision,
  source: ThemeSource,
  canUndo: Schema.Boolean,
});
export type ThemeView = typeof ThemeView.Type;

export const ThemeResponse = Schema.Struct({ theme: ThemeView });
export type ThemeResponse = typeof ThemeResponse.Type;

/** Stable identity for one account action; deterministic per accepted operation. */
export const ACTION_ID_MAX = 120;
export const ActionId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(ACTION_ID_MAX),
);
export type ActionId = typeof ActionId.Type;

/** Trusted origin: conversation object scope plus its native conversation id. */
export const ThemeOrigin = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300));
export type ThemeOrigin = typeof ThemeOrigin.Type;

export const ManualThemeWrite = Schema.Struct({
  expectedRevision: ThemeRevision,
  theme: ThemeId,
  actionId: ActionId,
});
export type ManualThemeWrite = typeof ManualThemeWrite.Type;

/** Prepared once, before native admission; never rebased afterwards. */
export const FrozenApply = Schema.Struct({
  kind: Schema.Literal("apply"),
  actionId: ActionId,
  operationId: ActionId,
  theme: ThemeId,
  expectedRevision: ThemeRevision,
});
export type FrozenApply = typeof FrozenApply.Type;

export const FrozenUndo = Schema.Struct({
  kind: Schema.Literal("undo"),
  actionId: ActionId,
  operationId: ActionId,
  targetActionId: ActionId,
  expectedRevision: ThemeRevision,
});
export type FrozenUndo = typeof FrozenUndo.Type;

export const ThemeCommand = Schema.Union([FrozenApply, FrozenUndo]);
export type ThemeCommand = typeof ThemeCommand.Type;

/** The immutable host intent stored with the accepted operation. */
export const FrozenIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    message: Schema.String.check(Schema.isMaxLength(400)),
  }),
  FrozenApply,
  FrozenUndo,
]);
export type FrozenIntent = typeof FrozenIntent.Type;

export const ThemeActionOutcome = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    code: Schema.Literals(["saved", "unchanged"]),
    changed: Schema.Boolean,
    theme: ThemeId,
    revision: ThemeRevision,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    code: Schema.Literals(["revision_conflict", "nothing_to_undo"]),
    currentTheme: ThemeId,
    currentRevision: ThemeRevision,
    message: Schema.String.check(Schema.isMaxLength(400)),
  }),
]);
export type ThemeActionOutcome = typeof ThemeActionOutcome.Type;

export const ActionReceipt = Schema.Struct({
  actionId: ActionId,
  fingerprint: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600)),
  origin: ThemeOrigin,
  before: Schema.Struct({ theme: ThemeId, revision: ThemeRevision }),
  result: ThemeActionOutcome,
});
export type ActionReceipt = typeof ActionReceipt.Type;

/** Origin-scoped Undo pointer: only this chat can consume its own last change. */
export const UndoTarget = Schema.Struct({
  targetActionId: ActionId,
  expectedRevision: ThemeRevision,
  theme: ThemeId,
});
export type UndoTarget = typeof UndoTarget.Type;

export const UndoTargetResponse = Schema.Struct({ target: Schema.NullOr(UndoTarget) });
export type UndoTargetResponse = typeof UndoTargetResponse.Type;

export const ActionReceiptResponse = Schema.Struct({ receipt: Schema.NullOr(ActionReceipt) });
export type ActionReceiptResponse = typeof ActionReceiptResponse.Type;

/** Catalog result for one applied command: the terminal receipt plus current state. */
export const ThemeCommandResponse = Schema.Struct({
  receipt: ActionReceipt,
  current: ThemeView,
});
export type ThemeCommandResponse = typeof ThemeCommandResponse.Type;

/** Canonical fingerprint: same action id with different frozen fields is a mismatch. */
export const fingerprintOf = (command: ThemeCommand): string => {
  const fields =
    command.kind === "apply"
      ? [
          "v1",
          "apply",
          command.actionId,
          command.operationId,
          String(command.expectedRevision),
          command.theme,
        ]
      : [
          "v1",
          "undo",
          command.actionId,
          command.operationId,
          command.targetActionId,
          String(command.expectedRevision),
        ];
  return fields.join("|");
};

export const THEME_FAILURES = ["invalid_input", "revision_conflict", "nothing_to_undo"] as const;
export const ThemeFailure = Schema.Literals(THEME_FAILURES);
export type ThemeFailure = typeof ThemeFailure.Type;

export type ThemeResolution<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ThemeFailure };

export const initialAccountTheme = (): AccountTheme => ({
  version: 1,
  revision: 0,
  theme: THEME_DEFAULT,
  source: "default",
  previous: null,
});

export const themeView = (record: AccountTheme, canUndo = false): ThemeView => ({
  theme: record.theme,
  revision: record.revision,
  source: record.source,
  canUndo: record.source === "account" && canUndo,
});
