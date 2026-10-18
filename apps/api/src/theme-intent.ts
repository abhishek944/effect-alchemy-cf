/**
 * The bounded trusted-intent test for AI theme actions.
 *
 * Authorization can only come from the user's own durable turn: the caller must
 * pass the latest authenticated submission text, never assistant prose, an
 * attachment or quoted document content. The test is deliberately narrow and
 * lexical. It is not a semantic guarantee: a user who pastes text naming a theme
 * can still authorize a change by accident, and a legitimate request phrased
 * without an action word or a theme name is refused instead of guessed. That
 * residual limitation is reported by the tool result and in the design record.
 */
import { THEME_IDS, type ThemeId } from "./theme-model.ts";

const THEME_WORDS: Readonly<Record<ThemeId, readonly string[]>> = {
  light: ["light", "day mode", "light mode", "light theme"],
  dark: ["dark", "night mode", "dark mode", "dark theme"],
  "midnight-black": ["midnight black", "midnight-black", "midnight"],
  dusk: ["dusk"],
  paper: ["paper", "sepia", "warm theme"],
};

const ACTION = /\b(apply|switch|set|change|use|make|go|turn|enable|adopt|select|choose)\b/;
const UNDO = /\b(undo|revert|go back|take back|put back|restore)\b/;
const THEME_SCOPE = /\b(theme|appearance|color scheme|colour scheme|mode)\b/;

export type IntentDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** True only when the user's own turn names the requested theme and asks for a change. */
export const authorizeThemeRequest = (text: string, theme: ThemeId): IntentDecision => {
  const value = text.toLowerCase();
  const named = THEME_WORDS[theme].some((word) => value.includes(word));
  if (!named)
    return {
      ok: false,
      message: `Your current message does not name the ${theme} theme, so I did not change it. Name the theme you want and I will switch.`,
    };
  if (!ACTION.test(value))
    return {
      ok: false,
      message: `Your current message does not ask for a theme change, so I did not switch to ${theme}. Ask me to apply it and I will.`,
    };
  return { ok: true };
};

/** Undo needs an explicit undo request about the theme; one step only. */
export const authorizeUndoRequest = (text: string): IntentDecision => {
  const value = text.toLowerCase();
  if (!UNDO.test(value))
    return {
      ok: false,
      message:
        "Your current message does not ask me to undo anything, so no theme change was reverted.",
    };
  if (!THEME_SCOPE.test(value))
    return {
      ok: false,
      message: "Tell me to undo the theme change specifically, and I will revert the last one.",
    };
  return { ok: true };
};

export const THEME_ID_LIST = THEME_IDS;
