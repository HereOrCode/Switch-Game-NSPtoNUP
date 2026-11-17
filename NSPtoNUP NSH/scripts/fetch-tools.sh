#!/usr/bin/env bash
#
# fetch-tools.sh — prepare nxpatch and nup for the current (or a given) platform in tools/<platform>/
#
# Usage:
#   scripts/fetch-tools.sh                      current platform: build both nxpatch and nup from source
#   scripts/fetch-tools.sh --nxpatch-only <platform> cross-compile nxpatch only (e.g. windows-x64, linux-x64)
#
# Requirements:
#   nxpatch  .NET SDK 11 (brew install dotnet-sdk); source in ../tools/nxpatch (see its README.md)
#            all platforms can be cross-compiled on one machine; the output bundles the .NET runtime, so users don't need .NET installed
#   nup      uv and git; PyInstaller can't cross-compile, so this must run on the target platform
# On Windows, run this in Git Bash (MSYS2 MINGW64).
# Set TOOLS_PLATFORM (e.g. windows-arm64) to override the detected platform.
#

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "${ROOT}/.." && pwd)"
NUP_REF="a4840f0"       # pinned commit of https://github.com/a55uka/nup
PYINSTALLER_VERSION="6.22.3"

log() { printf '==> %s\n' "$*"; }
fail() { printf '✘ %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux) OS=linux ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows ;;
  *) fail "Unsupported OS: $(uname -s)" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) fail "Unsupported architecture: $(uname -m)" ;;
esac
# TOOLS_PLATFORM overrides detection, e.g. in CI on Windows arm64 where Git Bash may run emulated and report x86_64
PLATFORM="${TOOLS_PLATFORM:-${OS}-${ARCH}}"
WORK="${ROOT}/.nsh/tools-build"
mkdir -p "$WORK"

exe() { [[ "$1" == windows-* ]] && echo ".exe" || echo ""; }

# Platform directory name → .NET RID
rid() {
  case "$1" in
    macos-arm64) echo osx-arm64 ;;
    macos-x64) echo osx-x64 ;;
    windows-x64) echo win-x64 ;;
    windows-arm64) echo win-arm64 ;;
    linux-x64) echo linux-x64 ;;
    linux-arm64) echo linux-arm64 ;;
    *) fail "Unsupported platform: $1" ;;
  esac
}

build_nxpatch() {
  local platform="$1" out="${ROOT}/tools/$1"
  command -v dotnet >/dev/null || fail "dotnet not found; install .NET SDK 11 first"
  [[ -f "${REPO}/tools/nxpatch/nxpatch.csproj" ]] || fail "${REPO}/tools/nxpatch/nxpatch.csproj not found"
  log "Building nxpatch ($(rid "$platform"))"
  mkdir -p "$out"
  dotnet publish "${REPO}/tools/nxpatch/nxpatch.csproj" -c Release -r "$(rid "$platform")" --self-contained true \
    -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true \
    -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none \
    -o "${WORK}/nxpatch/${platform}" >"${WORK}/nxpatch-${platform}.log" 2>&1 \
    || { tail -20 "${WORK}/nxpatch-${platform}.log" >&2; fail "nxpatch build failed"; }
  cp "${WORK}/nxpatch/${platform}/nxpatch$(exe "$platform")" "${out}/nxpatch$(exe "$platform")"
  chmod 755 "${out}/nxpatch$(exe "$platform")"
}

case "${1:-}" in
  --nxpatch-only)
    [[ $# -ge 2 ]] || fail "--nxpatch-only requires a platform, e.g. windows-x64"
    build_nxpatch "$2"
    log "Done: tools/$2/nxpatch$(exe "$2")"
    exit 0
    ;;
  -h|--help) sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) fail "Unknown argument: $1 (use --help for usage)" ;;
esac

OUT="${ROOT}/tools/${PLATFORM}"
EXE="$(exe "$PLATFORM")"
mkdir -p "$OUT"

# 1. nxpatch
build_nxpatch "$PLATFORM"
"${OUT}/nxpatch${EXE}" >/dev/null 2>&1 && fail "nxpatch self-check failed: running without arguments should exit with code 2" || [[ $? -eq 2 ]] || fail "nxpatch self-check failed"

# 2. nup: PyInstaller single file, without zstandard (the app doesn't compress)
log "Building nup (${NUP_REF})"
command -v uv >/dev/null || fail "uv not found"
if [[ ! -d "${WORK}/nup/.git" ]]; then
  git clone -q https://github.com/a55uka/nup "${WORK}/nup"
fi
git -C "${WORK}/nup" -c advice.detachedHead=false checkout -q -f "$NUP_REF"
# Fix the meta TLV numbering: upstream 1d904e1 made it start at 0 (NPDM = 0), but SPEC §5 starts at 0x0001
# (icon 0x0003, name 0x0005), so every record is off by one and spec readers find no icon or name.
# Skipped automatically once upstream fixes it
FORMAT_PY="${WORK}/nup/tools/nup/nup/format.py"
perl -pi -e 's/^    NPDM = 0\r?$/    NPDM = 1/' "$FORMAT_PY"
grep -q '^    NPDM = 1' "$FORMAT_PY" || grep -q '^TLV_NPDM = 0x0001' "$FORMAT_PY" \
  || fail "Can't confirm the TLV numbering in nup's format.py; check it before building"
VENV="${WORK}/nup-venv"
[[ -d "$VENV" ]] || uv venv -q -p 3.13 "$VENV"
PY="${VENV}/bin/python"; [[ $OS == windows ]] && PY="${VENV}/Scripts/python.exe"
uv pip install -q -p "$PY" "pyinstaller==${PYINSTALLER_VERSION}"
printf 'from nup.cli import main\nmain()\n' > "${WORK}/run_nup.py"
(
  cd "$WORK"
  "$PY" -m PyInstaller --onefile --name nup --clean --noconfirm \
    --paths "${WORK}/nup/tools/nup" --collect-submodules nup --exclude-module zstandard \
    --workpath "${WORK}/pyi-build" --distpath "${WORK}/dist" --specpath "$WORK" \
    run_nup.py >"${WORK}/pyinstaller.log" 2>&1
) || { tail -20 "${WORK}/pyinstaller.log" >&2; fail "nup packaging failed"; }
cp "${WORK}/dist/nup${EXE}" "${OUT}/nup${EXE}"
# Self-check: the name must land in TLV 0x0005 (type 05 00, reserved 00 00, size 08 00 00 00, then "TLVCHECK")
CHECK="${WORK}/tlv-check"
rm -rf "$CHECK"; mkdir -p "${CHECK}/dump/exefs"
printf 'main' > "${CHECK}/dump/exefs/main"
"${OUT}/nup${EXE}" pack -q --title-id 0100000000010000 --name TLVCHECK "${CHECK}/dump" "${CHECK}/t.nup" >/dev/null 2>&1 \
  || fail "nup self-check failed: pack"
"$PY" -c 'import sys; sys.exit(b"\x05\x00\x00\x00\x08\x00\x00\x00TLVCHECK" not in open(sys.argv[1], "rb").read())' "${CHECK}/t.nup" \
  || fail "nup self-check failed: the name is not in TLV 0x0005"

chmod 755 "${OUT}"/*
log "Done: tools/${PLATFORM}/"
ls -l "$OUT"
