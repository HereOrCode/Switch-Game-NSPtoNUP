// Settings: saved as settings.json in the data directory.

import { effect, signal } from "nsh";
import { joinList, L, languagePreference, msg, type LanguagePreference, type Msg } from "../i18n";
import { env, native } from "../native";

interface StoredSettings {
  keysPath?: string | null;
  titleKeysPath?: string | null;
  outputPath?: string | null;
  autoCover?: boolean;
  cleanupWorkDir?: boolean;
  notifyOnFinish?: boolean;
  categoryShortcuts?: boolean;
  /// UI language: system (follow the system), en, ja, zh-Hans
  language?: LanguagePreference;
}

/// prod.keys chosen by the player; the app doesn't provide it
export const keysPath = signal<string | null>(null);
/// Optional: the player's own title.keys (not provided by the app). Used for decryption when the NSP has no usable common .tik
export const titleKeysPath = signal<string | null>(null);
export const outputPath = signal<string | null>(null);
export const autoCover = signal(true);
export const cleanupWorkDir = signal(true);
/// Send a system notification when conversion finishes
export const notifyOnFinish = signal(true);
/// Whether ⌘1–⌘4 switch the main window's game categories (off by default; when off, category tabs show no shortcut hints)
export const categoryShortcuts = signal(false);

export const outputDirectory = () => outputPath() ?? env.defaultOutput;

/// prod.keys validation result; call refreshKeys to recheck after the file is modified elsewhere
const keysVersion = signal(0);
export const refreshKeys = () => keysVersion.update((n) => n + 1);
export const keysCheck = () => {
  keysVersion();
  const path = keysPath();
  return path ? native.checkKeys(path) : null;
};

/// prod.keys that is configured and passed validation
export const validKeysPath = (): string | null => {
  const check = keysCheck();
  return check && !check.unreadable && !check.missing ? keysPath() : null;
};

export const titleKeysCheck = () => {
  keysVersion();
  const path = titleKeysPath();
  return path ? native.checkTitleKeys(path) : null;
};

/// title.keys that is configured and has readable entries
export const validTitleKeysPath = (): string | null => {
  const check = titleKeysCheck();
  return check && !check.unreadable && check.count > 0 ? titleKeysPath() : null;
};

/// Why prod.keys can't be used (without key values); null when usable
export function keysProblem(): Msg | null {
  const check = keysCheck();
  if (!check) return null;
  if (check.unreadable) return msg("keys_problem_unreadable");
  if (check.missing) return msg("keys_problem_missing", check.missing.join(", "));
  return null;
}

/// Description of malformed, ignored entries (without key values)
export function ignoredKeysMessage(ignored: string[]): string | null {
  if (!ignored.length) return null;
  const names = joinList(ignored.slice(0, 3));
  return ignored.length > 3 ? L("keys_ignored_entries_more", names, ignored.length) : L("keys_ignored_entries", names);
}

/// Called by the app's root component: reads settings.json and writes it back when settings change
export function loadSettings() {
  let stored: StoredSettings = {};
  try {
    stored = JSON.parse(native.readData("settings.json") ?? "{}");
  } catch {}
  keysPath.set(stored.keysPath ?? null);
  titleKeysPath.set(stored.titleKeysPath ?? null);
  outputPath.set(stored.outputPath ?? null);
  autoCover.set(stored.autoCover ?? true);
  cleanupWorkDir.set(stored.cleanupWorkDir ?? true);
  notifyOnFinish.set(stored.notifyOnFinish ?? true);
  categoryShortcuts.set(stored.categoryShortcuts ?? false);
  const language = stored.language;
  languagePreference.set(language === "en" || language === "ja" || language === "zh-Hans" ? language : "system");

  effect(() => {
    const value: StoredSettings = {
      keysPath: keysPath(),
      titleKeysPath: titleKeysPath(),
      outputPath: outputPath(),
      autoCover: autoCover(),
      cleanupWorkDir: cleanupWorkDir(),
      notifyOnFinish: notifyOnFinish(),
      categoryShortcuts: categoryShortcuts(),
      language: languagePreference(),
    };
    native.writeData("settings.json", JSON.stringify(value, null, 2));
  });
}
