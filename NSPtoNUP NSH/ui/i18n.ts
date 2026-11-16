// UI languages: English, Japanese, Simplified Chinese. Strings live in locales/app.yml with flat snake_case keys (e.g. settings_language).
//   Follows the system's preferred language by default; falls back to English when it is none of these three (including Traditional Chinese).
//   A key missing a translation for the current language shows English.
//   The language can be set in settings; it takes effect immediately and is saved in settings.json.
//
// L("key", a, b) looks up a string, substituting args into %{1}, %{2}…; Lc("key", n, …) uses key_one when the English count is 1.
// Msg is storable text (key + args): failure reasons, warnings etc. are saved in the game library and follow language changes;
// the Rust part also returns only Msg, which the UI translates.

import { effect, localeSettings, signal, untracked } from "nsh";
import { setLocale, t } from "nsh/i18n";

export type UiLanguage = "en" | "ja" | "zh-Hans";
export type LanguagePreference = "system" | UiLanguage;

/// Options in settings: each language is shown in its own language
export const LANGUAGE_OPTIONS: { id: LanguagePreference; name: () => string }[] = [
  { id: "system", name: () => L("settings_language_system") },
  { id: "en", name: () => "English" },
  { id: "ja", name: () => "日本語" },
  { id: "zh-Hans", name: () => "简体中文" },
];

export const languagePreference = signal<LanguagePreference>("system");
/// The language actually displayed
export const uiLanguage = signal<UiLanguage>("en");

/// The language actually used: only the first system preferred language is considered; use it if supported, otherwise English
export function resolveLanguage(preference: LanguagePreference, preferred: readonly string[]): UiLanguage {
  if (preference !== "system") return preference;
  const first = (preferred[0] ?? "").toLowerCase();
  if (first.startsWith("en")) return "en";
  if (first.startsWith("ja")) return "ja";
  if (first === "zh" || first.startsWith("zh-hans") || first === "zh-cn" || first === "zh-sg" || first.startsWith("zh-cn-")) {
    return "zh-Hans";
  }
  return "en";
}

/// Called by the root component at startup: applies the language from settings and switches immediately when it changes
export function applyLanguage() {
  effect(() => {
    const preference = languagePreference();
    untracked(() => {
      // setLocale overwrites the first preferred language: restore the system setting first, then read the system's preferred language
      setLocale(null);
      const language = resolveLanguage(preference, localeSettings().languages);
      setLocale(language);
      uiLanguage.set(language);
    });
  });
}

type Arg = string | number | Msg;

/// Looks up UI text; args are substituted into %{1}, %{2}… (an arg can be another Msg)
export function L(key: string, ...args: Arg[]): string {
  uiLanguage();
  if (!args.length) return t(key);
  const options: Record<string, string> = {};
  args.forEach((arg, i) => (options[String(i + 1)] = argText(arg)));
  return t(key, options);
}

/// Text with a count: uses key_one when the English count is 1 (Japanese and Chinese have no plural forms). The count is the first arg
export function Lc(key: string, count: number, ...args: Arg[]): string {
  const resolved = count === 1 && uiLanguage() === "en" ? `${key}_one` : key;
  return L(resolved, count, ...args);
}

// MARK: - Storable text

/// Key + args. An arg can be text, a number, another Msg, or a group joined with a separator (join)
export interface Msg {
  key: string;
  args?: MsgArg[];
  /// The count that selects key_one when it is 1 in English
  count?: number;
}
export type MsgArg = string | number | Msg | { join: MsgArg[]; sep: string };

export const msg = (key: string, ...args: MsgArg[]): Msg => ({ key, args });
/// Untranslated text (game names, paths, tool output)
export const raw = (text: string): Msg => ({ key: "text_raw", args: [text] });
/// Segments concatenated directly (e.g. a log line's "✘ " prefix + the failure reason)
export const concat = (...parts: MsgArg[]): Msg => ({ key: "text_raw", args: [{ join: parts, sep: "" }] });
/// Title + details (on new lines)
export const withDetail = (title: Msg, detail: Msg | string | null | undefined): Msg =>
  detail == null || detail === "" ? title : { key: "text_with_detail", args: [title, detail] };

export function isMsg(value: unknown): value is Msg {
  return !!value && typeof value === "object" && typeof (value as Msg).key === "string";
}

function argText(arg: MsgArg): string {
  if (typeof arg === "string") return arg;
  if (typeof arg === "number") return String(arg);
  if ("join" in arg) return arg.join.map(argText).join(arg.sep);
  return text(arg);
}

/// The first line (the failure reason's title; details follow on later lines)
export const firstLine = (value: Msg | string | null | undefined) => text(value).split("\n")[0];

/// The text of a Msg (or a string from old data) in the current language
export function text(value: Msg | string | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  const args = value.args ?? [];
  if (value.count != null) return Lc(value.key, value.count, ...args.map((a) => argText(a)));
  return L(value.key, ...args.map((a) => argText(a)));
}

/// Reason for a failed async Rust call: Rust returns Msg as JSON; anything else is verbatim text
export function errorMsg(error: unknown): Msg {
  const message = String((error as any)?.message ?? error ?? "");
  if (message.startsWith("{")) {
    try {
      const parsed = JSON.parse(message);
      if (isMsg(parsed)) return parsed;
    } catch {}
  }
  return raw(message);
}

/// List joining: A, B and C (separators differ per language)
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(L("list_separator")) + L("list_and") + items[items.length - 1];
}
