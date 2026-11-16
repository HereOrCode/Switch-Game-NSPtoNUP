#!/usr/bin/env bash
#
# package-linux.sh — package the Linux build (must run on Linux; requires GTK 4 at runtime)
#
#   1. nsh package --target linux: .nsh/out/NSPtoNUP/ (executable + nsh/ + .desktop)
#   2. copy tools/linux-<arch>/ into NSPtoNUP/tools/
#   3. repackage as .nsh/out/NSPtoNUP-linux-<arch>.tar.gz
#
# Run scripts/fetch-tools.sh first to prepare the tools. Untested (this release is only verified on macOS).
#

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/.nsh/out"
log() { printf '==> %s\n' "$*"; }
fail() { printf '✘ %s\n' "$*" >&2; exit 1; }

case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) fail "Unsupported architecture: $(uname -m)" ;;
esac
TOOLS="${ROOT}/tools/linux-${ARCH}"
for tool in nxpatch nup; do
  [[ -x "${TOOLS}/${tool}" ]] || fail "Missing ${TOOLS}/${tool}; run scripts/fetch-tools.sh first"
done

log "nsh package (Linux ${ARCH})"
cd "$ROOT"
rm -rf "${OUT}/NSPtoNUP"
nsh package App.tsx --target linux --out "$OUT"
[[ -d "${OUT}/NSPtoNUP" ]] || fail "${OUT}/NSPtoNUP was not created"

log "Copying tools to NSPtoNUP/tools/"
mkdir -p "${OUT}/NSPtoNUP/tools"
install -m 755 "${TOOLS}"/{nxpatch,nup} "${OUT}/NSPtoNUP/tools/"

TARBALL="${OUT}/NSPtoNUP-linux-${ARCH}.tar.gz"
rm -f "$TARBALL"
tar -C "$OUT" -czf "$TARBALL" NSPtoNUP
log "Done: ${TARBALL#"${ROOT}/"}"
