# NSPtoNUP (NSH edition)

The cross-platform NSPtoNUP app, built with [NSH](https://nsh.dev/) (Native Shell). It converts
Nintendo Switch NSP files into NUP packages and runs on macOS, Windows and Linux.

- Interface: TSX (`App.tsx`, `ui/`)
- Conversion, files, dialogs, covers: a Rust crate (`src/`; TSX imports `Native` from `nsptonup/native`)
- Bundled tools: **nxpatch** (reads and decrypts NSPs, built on LibHac; source in `../tools/nxpatch`)
  and **nup** (writes NUP packages, from [a55uka/nup](https://github.com/a55uka/nup)), stored per
  platform in `tools/<platform>/` (generated, not committed)
- Merges base game + update + DLC into a single NUP; when a folder is added, its contents are
  identified and grouped automatically

Developed and tested mainly on macOS; Windows and Linux builds are packaged on their own platforms.

## Requirements

- [NSH](https://nsh.dev/docs/installation) 0.5.1, plus its platform requirements
  (GTK 4 on Linux; Visual Studio Build Tools and LLVM on Windows)
- Rust via rustup (`rust-toolchain.toml` pins 1.97; rustup installs it automatically)
- .NET SDK 11 (for nxpatch), [uv](https://docs.astral.sh/uv/) and git (for nup)

## Setup

Build nxpatch and nup for the current platform into `tools/<platform>/`:

```sh
scripts/fetch-tools.sh                              # build nxpatch and nup from source
scripts/fetch-tools.sh --nxpatch-only windows-x64   # cross-compile nxpatch only, for one platform
```

nup is packaged with PyInstaller, which can't cross-compile, so it is always built on the target
platform. On Windows, run the script in Git Bash.

## Development

```sh
scripts/dev.sh                   # run (real game library); tools are prepared on first run
scripts/dev.sh --mock            # demo mode: 30 demo games (separate data directory; the real game library is untouched)
scripts/dev.sh --add game.nsp    # add an NSP or folder after launch
nsh check                        # cargo check + TypeScript type check
cargo test                       # Rust unit tests
nsh test App.tsx                 # Rust unit tests + ui/*.test.ts (interface language, translations)
scripts/check-locales.py         # check interface text: every used key exists, Japanese and Simplified Chinese are complete, parameters match
scripts/fix-nup-tlv.py <nup|folder>  # fix NUPs made by 1.0.0 / 1.0.1 (meta TLV numbering one off); --dry-run to check only
```

`cargo test e2e -- --ignored --nocapture` runs one full conversion; it needs your own `prod.keys`
and a sample NSP (see the `e2e` module in `src/lib.rs` for the expected paths).

## Interface language

English, Japanese and Simplified Chinese. The text lives in `locales/app.yml` (keys are flat
snake_case, parameters are written `%{1}`, `%{2}`; English singular forms get an extra `key_one`).

- By default the app follows the first entry of the system's preferred languages; if that is none of
  these three (including Traditional Chinese), English is shown. If a key is missing in the current
  language, English is shown.
- Settings › General › Language lets you choose one; it takes effect immediately and is saved as
  `language` in `settings.json`.
- The Rust side contains no interface text and only returns a key + parameters (`Msg`, see
  `src/error.rs`). Conversion failure reasons, warnings and reasons a file can't be read are stored
  in the game library as `Msg` (`lastErrorMessage`, `warningMessages`, `metadataErrorMessage`), so
  they follow language changes.
- nxpatch error codes (`nxpatch-error` lines, and `error` lines from identify) are mapped to
  `nxpatch_error_*` keys in `describe` in `src/nxpatch.rs`; unknown codes show nxpatch's English
  description.

## Packaging

```sh
scripts/package-macos.sh [--run] [--zip]   # .nsh/out/NSPtoNUP.app (and NSPtoNUP-macos-<arch>.zip)
scripts/package-linux.sh                   # on Linux: .nsh/out/NSPtoNUP-linux-<arch>.tar.gz
scripts/package-windows.ps1                # on Windows: .nsh/out/NSPtoNUP-windows-<arch>.zip
```

`nsh package` can't bundle extra files, so the scripts copy `tools/<platform>/` into the output
after packaging (macOS: `Contents/Resources/tools/`; Windows / Linux: `tools/` next to the
executable), and on macOS the app is then re-signed with ad hoc signing.

Release builds for all platforms (macOS arm64, Windows x64 / arm64, Linux x64 / arm64) run on
GitHub Actions: see `.github/workflows/release.yml` at the repository root.

## Data

| | Location |
|---|---|
| Game library, settings, covers | NSH's data directory: macOS `~/Library/Application Support/com.hellomateo.nsptonup/` |
| Temporary conversion files | `NSPtoNUP NSH/work` under the cache directory (macOS `~/Library/Caches/NSPtoNUP NSH/work`) |
| Default output | `~/Documents/NSPtoNUP` |

For prod.keys and title.keys, the app only remembers the path and validates the format; the files
are never copied or uploaded. nxpatch picks the title key itself from the NSP's common ticket or from
title.keys, so key values never pass through the app and never appear on command lines or in logs
(tool output is still redacted).

For nxpatch's command line, see `../tools/nxpatch/README.md`.
