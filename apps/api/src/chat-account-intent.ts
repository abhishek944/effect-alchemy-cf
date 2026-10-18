/**
 * Bounded direct-command grammar for account theme actions.
 *
 * Authorization may only come from the user's own authenticated message, and only
 * from a whole, affirmative, unambiguous command. Quoted or pasted material,
 * negations, code fences and unclear phrasing fail closed. The grammar is
 * deliberately small: it recognizes the command forms the product supports
 * instead of promising to infer arbitrary natural language, and any text that
 * mentions a theme without forming a supported command is reported as
 * `unavailable` with an honest message rather than silently authorized.
 */
import type { ThemeId } from "./theme-model.ts";

export type ParsedThemeCommand =
  | { readonly kind: "none" }
  | { readonly kind: "apply"; readonly theme: ThemeId }
  | { readonly kind: "undo" }
  | { readonly kind: "unavailable"; readonly message: string };

const QUOTES = /["'`“”‘’«»„“]|\{\{|\}\}|```|<[^>]+>/;
const NEGATION =
  /\b(do not|don't|dont|does not|doesn't|never|no need|without|refuse|refusing|not to|shouldn't|won't|will not|cannot|can't|instead of|rather than)\b/;
const THEME_ACTION =
  "(apply|switch|set|change|use|turn on|enable|adopt|select|choose|make it|go with|activate)";
const SCOPE =
  "(?:the |my |this |our )?(?:theme|appearance|colour scheme|color scheme|dashboard theme|mode)";
const PLEASE = "(?:please\\s+|pls\\s+)?";

/** Longest-first so `midnight black` never matches as `black`-less `midnight` alone. */
const THEME_ALIASES: readonly { readonly theme: ThemeId; readonly pattern: string }[] = [
  { theme: "midnight-black", pattern: "midnight[- ]?black" },
  { theme: "midnight-black", pattern: "midnight" },
  { theme: "paper", pattern: "paper" },
  { theme: "dusk", pattern: "dusk" },
  { theme: "light", pattern: "light" },
  { theme: "dark", pattern: "dark" },
];

const ALIAS = THEME_ALIASES.map((alias) => alias.pattern).join("|");

const APPLY_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `^${PLEASE}(?:could |can |would |will )?you\\s+${THEME_ACTION}\\s+(?:it\\s+|everything\\s+)?(?:to\\s+|into\\s+)?(?:the\\s+|my\\s+)?(?:${ALIAS})(?:\\s+(?:theme|mode))?\\s*$`,
    "i",
  ),
  new RegExp(
    `^${PLEASE}${THEME_ACTION}\\s+${SCOPE}\\s*(?:to\\s+|into\\s+)?(?:the\\s+)?(?:${ALIAS})(?:\\s+(?:theme|mode))?\\s*$`,
    "i",
  ),
  new RegExp(
    `^${PLEASE}${THEME_ACTION}\\s+(?:to\\s+|into\\s+)?(?:the\\s+)?(?:${ALIAS})(?:\\s+(?:theme|mode))?\\s*$`,
    "i",
  ),
  new RegExp(`^${PLEASE}(?:${ALIAS})\\s+(?:theme|mode)(?:\\s+please)?\\s*$`, "i"),
  new RegExp(`^${PLEASE}(?:make|set)\\s+the\\s+(?:dashboard|app)\\s+(?:${ALIAS})\\s*$`, "i"),
];

const UNDO_PATTERNS: readonly RegExp[] = [
  /^(?:please\s+)?(?:undo|revert|roll back|take back|put back|restore)\s+(?:the|my|that|this)?\s*(?:last\s+)?(?:theme|appearance|colour scheme|color scheme)(?:\s+(?:change|choice|switch|selection))?\s*$/i,
  /^(?:please\s+)?(?:undo|revert|roll back)\s+(?:the|my|that|this)\s+(?:theme|appearance)\s+(?:change|choice|switch|selection)\s*$/i,
];

const aliasesIn = (text: string): readonly ThemeId[] => {
  const found: ThemeId[] = [];
  for (const alias of THEME_ALIASES) {
    const pattern = new RegExp(`\\b${alias.pattern}\\b`, "i");
    if (pattern.test(text) && !found.includes(alias.theme)) found.push(alias.theme);
  }
  return found;
};

const UNSUPPORTED_COMMAND =
  "I can change the theme only for a direct request like “switch to paper” or “undo the theme change”. " +
  "Ask me in that form and I will apply it; quoted or pasted text is never treated as a command.";

/**
 * Parses one authenticated user message. `apply`/`undo` are affirmative direct
 * commands only; anything else is `none` (ordinary chat) or `unavailable` with a
 * truthful reason, never an implicit grant.
 */
export const parseThemeCommand = (raw: string): ParsedThemeCommand => {
  const text = raw.trim();
  if (text.length === 0 || text.length > 500) return { kind: "none" };
  const singleLine = text.replace(/\s+/g, " ");
  if (QUOTES.test(singleLine)) {
    if (aliasesIn(singleLine).length === 0 && !/\b(theme|appearance)\b/i.test(singleLine))
      return { kind: "none" };
    return { kind: "unavailable", message: UNSUPPORTED_COMMAND };
  }
  if (NEGATION.test(singleLine)) {
    if (aliasesIn(singleLine).length === 0 && !/\b(theme|appearance)\b/i.test(singleLine))
      return { kind: "none" };
    return { kind: "unavailable", message: UNSUPPORTED_COMMAND };
  }
  const mentioned = aliasesIn(singleLine);
  if (mentioned.length > 1) return { kind: "unavailable", message: UNSUPPORTED_COMMAND };
  for (const pattern of UNDO_PATTERNS) {
    if (pattern.test(singleLine)) return { kind: "undo" };
  }
  for (const pattern of APPLY_PATTERNS) {
    const match = pattern.exec(singleLine);
    if (match === null) continue;
    const matched = aliasesIn(match[0]);
    if (matched.length !== 1) return { kind: "unavailable", message: UNSUPPORTED_COMMAND };
    const theme = matched[0];
    if (theme === undefined) return { kind: "unavailable", message: UNSUPPORTED_COMMAND };
    return { kind: "apply", theme };
  }
  // A question or a remark about the theme is never a command; it simply grants
  // nothing, so ordinary conversation stays unaffected.
  if (singleLine.endsWith("?")) return { kind: "none" };
  if (mentioned.length === 1 || /\b(theme|appearance)\b/i.test(singleLine))
    return { kind: "unavailable", message: UNSUPPORTED_COMMAND };
  return { kind: "none" };
};
