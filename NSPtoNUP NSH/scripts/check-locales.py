#!/usr/bin/env python3
# Checks the interface text (locales/app.yml):
#   1. every key used in code exists (TSX L / Lc / msg / { key: … }, Rust Msg / AppError / failure)
#   2. every key has English; Japanese and Simplified Chinese are complete (except English singular forms *_one)
#   3. parameters (%{1}, %{2}, …) match across languages
# Usage: scripts/check-locales.py (exit code 1 if there are problems)

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANGUAGES = ("en", "ja", "zh-Hans")
# Keys built from a name at runtime (languageName in ui/components/forms.tsx)
DYNAMIC_PREFIXES = ("language_name_",)

def load():
    entries, current = {}, None
    for line in (ROOT / "locales/app.yml").read_text(encoding="utf-8").splitlines():
        if m := re.match(r"^([a-z0-9_]+):\s*$", line):
            current = m.group(1)
            if current in entries:
                print(f"Duplicate key: {current}")
            entries[current] = {}
        elif (m := re.match(r"^  (en|ja|zh-Hans): (.*)$", line)) and current:
            entries[current][m.group(1)] = json.loads(m.group(2))
    return entries

def used_keys():
    pattern = re.compile(
        r'(?:\bL|\bLc|\bmsg|Msg::new|Msg::with|AppError::key|AppError::with|\.failure)\(\s*"([a-z0-9_]+)"'
        r'|\bkey: "([a-z0-9]+_[a-z0-9_]+)"'
        r'|run_tool\([^;]*?"(error_[a-z0-9_]+)"'
    )
    files = [ROOT / "App.tsx", *ROOT.glob("ui/**/*.ts"), *ROOT.glob("ui/**/*.tsx"), *ROOT.glob("src/**/*.rs")]
    keys = {}
    for file in files:
        if file.name.endswith(".test.ts"):
            continue
        # Examples in comments don't count
        code = "\n".join(l for l in file.read_text(encoding="utf-8").splitlines() if not l.lstrip().startswith("//"))
        for m in pattern.finditer(code):
            keys.setdefault(next(g for g in m.groups() if g), file.relative_to(ROOT))
    return keys

def main():
    entries = load()
    problems = []
    for key, file in sorted(used_keys().items()):
        if key not in entries:
            problems.append(f"Missing key {key} ({file})")
    for key, values in entries.items():
        if "en" not in values:
            problems.append(f"{key} has no English")
            continue
        if not key.endswith("_one"):
            for language in LANGUAGES[1:]:
                if language not in values:
                    problems.append(f"{key} has no {language}")
        params = set(re.findall(r"%\{(\w+)\}", values["en"]))
        for language, value in values.items():
            # Singular forms may spell the count out in words (e.g. "1 game")
            if not key.endswith("_one") and set(re.findall(r"%\{(\w+)\}", value)) != params:
                problems.append(f"{key}: {language} parameters don't match English")
    for prefix in DYNAMIC_PREFIXES:
        if not any(k.startswith(prefix) for k in entries):
            problems.append(f"No {prefix}* keys")
    for problem in problems:
        print(problem)
    print(f"{len(entries)} keys, {len(problems)} problems")
    return 1 if problems else 0

if __name__ == "__main__":
    sys.exit(main())
