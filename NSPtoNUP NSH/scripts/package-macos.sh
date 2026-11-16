#!/usr/bin/env bash
#
# package-macos.sh — package the macOS NSPtoNUP.app
#
#   1. nsh package --target macos (ad hoc signed .app, requires macOS 14+)
#   2. copy nxpatch and nup from tools/macos-<arch>/ into Contents/Resources/tools/
#   3. re-sign the whole .app with ad hoc signing (tools included) and remove the quarantine attribute
#
# Usage:
#   scripts/package-macos.sh              build for this Mac's architecture, output to .nsh/out/NSPtoNUP.app
#   scripts/package-macos.sh --run        open the app after packaging
#   scripts/package-macos.sh --zip        also create .nsh/out/NSPtoNUP-macos-<arch>.zip
#
# Run scripts/fetch-tools.sh first to prepare the tools.
#

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/.nsh/out"
APP="${OUT}/NSPtoNUP.app"
RUN=0
ZIP=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --zip) ZIP=1 ;;
    -h|--help) sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
fail() { printf '✘ %s\n' "$*" >&2; exit 1; }

case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) fail "Unsupported architecture: $(uname -m)" ;;
esac
TOOLS="${ROOT}/tools/macos-${ARCH}"
for tool in nxpatch nup; do
  [[ -x "${TOOLS}/${tool}" ]] || fail "Missing ${TOOLS}/${tool}; run scripts/fetch-tools.sh first"
done

log "nsh package (macOS ${ARCH})"
cd "$ROOT"
rm -rf "$APP"
nsh package App.tsx --target macos --out "$OUT"
[[ -d "$APP" ]] || fail "${APP} was not created"

log "Copying tools to Contents/Resources/tools/"
mkdir -p "${APP}/Contents/Resources/tools"
for tool in nxpatch nup; do
  ditto "${TOOLS}/${tool}" "${APP}/Contents/Resources/tools/${tool}"
  chmod 755 "${APP}/Contents/Resources/tools/${tool}"
done

log "Re-signing (ad hoc)"
for tool in nxpatch nup; do
  codesign --force --sign - "${APP}/Contents/Resources/tools/${tool}"
done
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"
xattr -cr "$APP"

if [[ $ZIP -eq 1 ]]; then
  ZIPFILE="${OUT}/NSPtoNUP-macos-${ARCH}.zip"
  rm -f "$ZIPFILE"
  ditto -c -k --keepParent "$APP" "$ZIPFILE"
  log "Created ${ZIPFILE#"${ROOT}/"}"
fi

log "Done: ${APP#"${ROOT}/"} ($(du -sh "$APP" | cut -f1))"
[[ $RUN -eq 1 ]] && open "$APP"
exit 0
