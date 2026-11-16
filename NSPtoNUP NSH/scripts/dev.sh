#!/usr/bin/env bash
#
# dev.sh — run NSPtoNUP in a macOS development window (TSX changes hot-reload, Rust changes rebuild automatically)
#
# Usage:
#   scripts/dev.sh                  use the real game library
#   scripts/dev.sh --mock           demo mode: 30 demo games, Pikmin 4 converting, two queued
#                                   (separate data directory, rebuilt on every launch; the real game library is untouched)
#   scripts/dev.sh --add <path>     add an NSP or folder after launch (base game, update and DLC are detected automatically; can be combined with --mock)
#
# The first run compiles Rust and the development host, which takes a few minutes. Press Ctrl-C or close the window to quit.
#

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOCK=0
ADD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mock) MOCK=1; shift ;;
    --add) [[ $# -ge 2 ]] || { echo "--add requires an NSP path" >&2; exit 1; }; ADD="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    -h|--help) sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1 (use --help for usage)" >&2; exit 1 ;;
  esac
done

command -v nsh >/dev/null || { echo "✘ nsh not found; install it first: brew install nsh" >&2; exit 1; }

# Tools: built from source into tools/macos-<arch>/ on first run (needs .NET SDK 11 and uv)
case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
if [[ ! -x "${ROOT}/tools/macos-${ARCH}/nxpatch" || ! -x "${ROOT}/tools/macos-${ARCH}/nup" ]]; then
  echo "==> Preparing nxpatch / nup"
  "${ROOT}/scripts/fetch-tools.sh"
fi

# Demo-mode covers are read from a local cache if present; without it, demo games have no images
if [[ $MOCK -eq 1 && ! -d "${HOME}/Library/Caches/NSPtoNUP/MockAssets" ]]; then
  echo "Note: demo cover cache not found (~/Library/Caches/NSPtoNUP/MockAssets); demo games will have no images."
fi

cd "$ROOT"
export NSPTONUP_MOCK=$MOCK
[[ -n "$ADD" ]] && export NSPTONUP_ADD="$ADD"
echo "==> nsh run$([[ $MOCK -eq 1 ]] && echo " (demo mode)")"
exec nsh run --window-size 1000x640
