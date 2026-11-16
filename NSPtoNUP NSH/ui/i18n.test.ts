// UI language selection and Msg translation: nsh test App.tsx

import { setLocale } from "nsh/i18n";
import { describe, expect, test } from "nsh/test";
import { joinList, L, Lc, resolveLanguage, text, uiLanguage, type Msg } from "./i18n";

/// Sets the language (same as applyLanguage: nsh's language switches together with uiLanguage)
function use(language: "en" | "ja" | "zh-Hans") {
  setLocale(language);
  uiLanguage.set(language);
}

describe("resolveLanguage", () => {
  test("the language set in settings takes precedence", () => {
    expect(resolveLanguage("ja", ["zh-Hans-CN"])).toBe("ja");
  });

  test("following the system: only the first preferred language counts", () => {
    expect(resolveLanguage("system", ["ja-JP", "en-US"])).toBe("ja");
    expect(resolveLanguage("system", ["en-GB"])).toBe("en");
    expect(resolveLanguage("system", ["zh-Hans-CN"])).toBe("zh-Hans");
    expect(resolveLanguage("system", ["zh-CN"])).toBe("zh-Hans");
    expect(resolveLanguage("system", ["fr-FR", "ja-JP"])).toBe("en");
  });

  test("Traditional Chinese and unsupported languages use English", () => {
    expect(resolveLanguage("system", ["zh-Hant-TW"])).toBe("en");
    expect(resolveLanguage("system", ["zh-TW"])).toBe("en");
    expect(resolveLanguage("system", ["zh-HK"])).toBe("en");
    expect(resolveLanguage("system", [])).toBe("en");
  });
});

describe("translation", () => {
  test("args and English singular", () => {
    use("en");
    expect(L("error_disk_space", "38 GB", "21 GB")).toBe("Not enough disk space: about 38 GB needed, 21 GB available");
    expect(Lc("count_games", 1)).toBe("1 game");
    expect(Lc("count_games", 3)).toBe("3 games");
    use("zh-Hans");
    expect(Lc("count_games", 1)).toBe("1 个游戏");
  });

  test("missing translations show English", () => {
    use("ja");
    // duration_hours_one exists only in English; Japanese uses duration_hours for a count of 1
    expect(Lc("duration_hours", 1)).toBe("約 1 時間");
    expect(L("duration_hours_one")).toBe("About 1 hour");
  });

  test("Msg follows the language and can be nested", () => {
    const reason: Msg = {
      key: "text_with_detail",
      args: [{ key: "error_extract_failed" }, { key: "nxpatch_error_missing_key", args: ["key_area_key_application_11"] }],
    };
    use("en");
    expect(text(reason).split("\n")[0]).toBe("Extraction failed");
    use("zh-Hans");
    expect(text(reason).split("\n")[0]).toBe("提取失败");
    // nxpatch part line: %{1} is the file count, %{2} is the part
    const part: Msg = { key: "log_part_files", args: [{ key: "log_part_base", args: ["romfs"] }], count: 1 };
    use("en");
    expect(text(part)).toBe("Base romfs: 1 file");
    use("ja");
    expect(text({ ...part, count: 5172 })).toContain("5172");
  });

  test("list joining", () => {
    use("en");
    expect(joinList(["A", "B", "C"])).toBe("A, B and C");
    use("zh-Hans");
    expect(joinList(["A", "B", "C"])).toBe("A、B 和 C");
  });
});
