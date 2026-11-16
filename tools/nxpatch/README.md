# nxpatch

nxpatch reads Nintendo Switch NSP files and extracts their content into the dump layout used by
[nup](https://github.com/a55uka/nup). It is the NSP reader behind NSPtoNUP and is built on
[LibHac](https://www.nuget.org/packages/LibHac).

- Reads NCAs **directly from the NSP**; nothing is unpacked to disk first.
- Supports base games, **updates in the newer BKTR format** (combined with the base into complete
  patched content) and DLC.
- Picks title keys by itself: common tickets inside the NSP first, then an optional `title.keys`.
  **Key values are never printed**, and callers never pass key values on the command line.

You need your own `prod.keys` (and optionally `title.keys`) dumped from your own console.
nxpatch does not include any keys.

## Building

Requirements: the [.NET SDK](https://dotnet.microsoft.com/download) 11. The first build downloads
LibHac and the runtime pack for the target platform from nuget.org.

```sh
dotnet publish tools/nxpatch/nxpatch.csproj -c Release -r <RID> --self-contained true \
    -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true \
    -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none \
    -o build/nxpatch/<RID>
```

| Platform | RID | Output | Size (approx.) |
|---|---|---|---|
| macOS (Apple silicon) | `osx-arm64` | `nxpatch` | 37 MB |
| macOS (Intel) | `osx-x64` | `nxpatch` | 41 MB |
| Windows x64 | `win-x64` | `nxpatch.exe` | 41 MB |
| Windows ARM64 | `win-arm64` | `nxpatch.exe` | – |
| Linux x64 | `linux-x64` | `nxpatch` | 41 MB |
| Linux ARM64 | `linux-arm64` | `nxpatch` | – |

The output is a single executable that bundles the .NET runtime; the machine running it does not
need .NET installed. You can cross-compile every platform from one machine (verified on macOS arm64
for `osx-x64`, `win-x64` and `linux-x64`).

**Self-check:** running without arguments prints the usage and exits with code 2.

### Platform notes

| Platform | Notes |
|---|---|
| macOS | When signing with the hardened runtime, add the entitlements `com.apple.security.cs.allow-jit`, `com.apple.security.cs.disable-library-validation` and `com.apple.security.cs.allow-unsigned-executable-memory` (the single-file bundle extracts and loads its own libraries). |
| Windows | The executable is `nxpatch.exe`. |
| Linux | Make sure the file is executable (`chmod 755`). |
| All | The first run extracts the bundled libraries to a temporary directory; later starts take about 0.1 s. |

## Usage

Every command needs `-k <prod.keys>`. `--titlekeys <title.keys>` is optional.

### identify

```sh
nxpatch identify -k prod.keys a.nsp b.nsp ...
```

Identifies any number of NSPs in one call (35 files take about 0.6 s; only the small Meta NCA is
read). One tab-separated line per file:

```
content	<path>	<base|update|dlc>	<title id>	<version>
error	<path>	<code>	<detail>	<message>
```

- The title ID is 16 uppercase hex digits. The version is the cnmt version in decimal; its upper
  16 bits are the revision (for example `589824` is revision 9).
- Content belongs to the same game when `title id & ~0x1FFF` is equal (updates end in `800`,
  DLC uses `1001`–`1FFF`).

### control

```sh
nxpatch control -k prod.keys [--titlekeys title.keys] --nsp game.nsp --out <dir>
```

Writes `control.nacp` and `icon_<language>.dat` (JPEG) to `<dir>`. Works for updates too, which
gives the updated display version.

### extract

```sh
nxpatch extract -k prod.keys [--titlekeys title.keys] \
    --base base.nsp [--update update.nsp] [--dlc dlc1.nsp --dlc dlc2.nsp ...] \
    --out <dump dir>
```

Produces a layout that `nup pack` accepts as is:

```
<dump dir>/
├─ base/{exefs,romfs}
├─ updates/<version>/{exefs,romfs}     ← complete patched content
└─ dlc/<title id>/0/romfs
```

Output lines (tab-separated):

```
total	<bytes>
part	<base|update|dlc>	<exefs|romfs>	<file count>	<revision or title id>
progress	<bytes done>                ← at most one line every 0.25 s
```

`--base` must be a base game, and `--update` / `--dlc` must belong to it.

### Typical flow

```sh
nxpatch identify -k prod.keys *.nsp
nxpatch control  -k prod.keys --nsp update.nsp --out work/control
nxpatch extract  -k prod.keys --base base.nsp --update update.nsp --dlc dlc.nsp --out work/dump
nup pack work/dump game.nup --name "…" --display-version 1.0.1 --icon cover.jpg
nup verify game.nup
```

## Errors

| Exit code | Meaning |
|---|---|
| 0 | Success. With `identify`, per-file failures are reported as `error` lines and the exit code is still 0. |
| 1 | Failure. One tab-separated line on stderr: `nxpatch-error <code> <detail> <message>` |
| 2 | Invalid arguments; the usage is printed to stderr. |

The code is stable and meant for callers to translate; the message is English text for logs.

| Code | Detail | Meaning |
|---|---|---|
| `invalid_nsp` | – | Not a valid NSP (PFS0) file |
| `nsz_unsupported` | – | NSZ package; decompress it to NSP first |
| `no_cnmt` | – | No content metadata (cnmt) in the NSP |
| `bad_cnmt` | – | The content metadata is damaged |
| `unsupported_type` | content type, e.g. `0x83` | Not a base game, update or DLC |
| `not_base` | `update` or `dlc` | `--base` is not a base game |
| `update_mismatch` | file name | `--update` is not an update for this game |
| `dlc_mismatch` | file name | `--dlc` is not DLC for this game |
| `nca_not_found` | `program`, `control` or `data` | The required NCA is missing |
| `missing_key` | key name, e.g. `key_area_key_application_15` | prod.keys lacks a key needed for this game's firmware |
| `missing_title_key` | rights ID | No usable common ticket and no title.keys entry |
| `unknown` | – | Any other error; see the message |

Malformed entries in prod.keys (for example 34-digit `*_kek_source` values written by some dump
tools) are skipped and do not affect decryption.

## License

nxpatch uses [LibHac](https://www.nuget.org/packages/LibHac) 0.19.0 under the MIT License
(Copyright © 2018-2022 Alex Barney). The published executable bundles the .NET runtime, which is
also MIT licensed.
