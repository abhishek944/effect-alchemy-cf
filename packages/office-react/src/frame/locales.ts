import { Schema } from "effect";
import { LocaleType, mergeLocales, type ILanguagePack, type LanguageValue } from "@univerjs/core";
import SheetsEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import DocsEnUS from "@univerjs/preset-docs-core/locales/en-US";
import DocsUIEnUS from "@univerjs/docs-ui/locale/en-US";
import UIEnUS from "@univerjs/ui/locale/en-US";
import SlidesEnUS from "@univerjs-pro/slides/locale/en-US";
import SlidesUIEnUS from "@univerjs-pro/slides-ui/locale/en-US";
import CollaborationEnUS from "@univerjs-pro/collaboration-client-ui/locale/en-US";

const value: Schema.Codec<LanguageValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.String,
    Schema.Boolean,
    pack,
    Schema.mutable(Schema.Array(Schema.String)),
    Schema.mutable(Schema.Array(pack)),
  ]),
);
const pack: Schema.Codec<ILanguagePack> = Schema.Record(Schema.String, value);
const decode = Schema.decodeUnknownSync(pack);
const sheets: unknown = SheetsEnUS;
const docs: unknown = DocsEnUS;
const merged: unknown = mergeLocales(
  decode(sheets),
  decode(docs),
  DocsUIEnUS,
  UIEnUS,
  SlidesEnUS,
  SlidesUIEnUS,
  CollaborationEnUS,
);
export const nativeLocales = { [LocaleType.EN_US]: decode(merged) };
