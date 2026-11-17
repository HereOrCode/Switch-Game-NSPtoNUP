#!/usr/bin/env python3
"""
fix-nup-tlv.py: fix the meta TLV numbering of NUPs made by NSPtoNUP 1.0.0 and 1.0.1 (in place, no repacking)

Usage:
  python3 fix-nup-tlv.py Game.nup …       fix the given files (any extension)
  python3 fix-nup-tlv.py ~/NUP-folder     fix every .nup in a folder and its subfolders
  python3 fix-nup-tlv.py --dry-run …      only check, change nothing

Background: nup commit 1d904e1 (2026-11-04) made the TLV numbering start at 0, while SPEC §5 starts at 0x0001,
so every record in NUPs packed with it is one below the spec (icon in 0x0002, name in 0x0004, …) and readers
that follow the spec find no icon or name. scripts/fetch-tools.sh patches nup when building it.

The fix adds 1 to the type of every TLV record: only 2 bytes in each record header change, sizes and offsets
stay the same. Meta blocks are not covered by the TOC SHA-256, so nup verify still passes afterwards.

How shifted files are recognized: the old nup writes a source dump name in every package as 0x0007, which the
spec defines as a 32-byte build ID. A 0x0000 record (not in the spec) or a 0x0007 record that isn't 32 bytes
means the file is shifted. Files that already follow the spec are skipped, so running it twice is safe.
Uses only the Python standard library.
"""

import os
import struct
import sys

SUPER = struct.Struct("<4sHHQQ32sQQII16s32x")  # 0x80
PACKAGE = struct.Struct("<QIIIIBBHIQI20x")      # 0x40
TLV = struct.Struct("<HHI")                     # 8
TOC_HEAD_SIZE = 0x30
BUILD_ID_SIZE = 32
SOURCE_DUMP_OLD = 0x0007
LAST_TYPE = 0x000A  # Localized icons


def records(fh):
    """Every package's meta records: [(absolute offset of the record header, type, size)]"""
    fh.seek(0)
    head = fh.read(SUPER.size)
    if len(head) < SUPER.size:
        raise ValueError("too small to be a NUP")
    magic, _hs, _hv, toc_offset, _toc_size, _sha, _blob, file_size, count, _flags, _uuid = SUPER.unpack(head)
    if magic != b"NUP\x01":
        raise ValueError("not a NUP v1 file")
    if file_size != os.fstat(fh.fileno()).st_size:
        raise ValueError("file size doesn't match the header; the file may be incomplete")
    out = []
    for i in range(count):
        fh.seek(toc_offset + TOC_HEAD_SIZE + i * PACKAGE.size)
        fields = PACKAGE.unpack(fh.read(PACKAGE.size))
        meta_offset, meta_size = fields[9], fields[10]
        if not meta_offset or not meta_size:
            continue
        fh.seek(meta_offset)
        block = fh.read(meta_size)
        pos = 0
        while pos + TLV.size <= len(block):
            kind, _r, size = TLV.unpack_from(block, pos)
            if pos + TLV.size + size > len(block):
                raise ValueError("damaged meta block (TLV out of range)")
            out.append((meta_offset + pos, kind, size))
            pos += TLV.size + size
    return out


def check(recs):
    """'shifted', 'ok' (follows the spec) or 'unknown'"""
    kinds = {kind for _, kind, _ in recs}
    if 0 in kinds or any(kind == SOURCE_DUMP_OLD and size != BUILD_ID_SIZE for _, kind, size in recs):
        return "shifted"
    if kinds & {0x0001, 0x0008} or any(kind == 0x0007 and size == BUILD_ID_SIZE for _, kind, size in recs):
        return "ok"
    return "unknown"


def fix(path, dry_run):
    with open(path, "rb" if dry_run else "r+b") as fh:
        recs = records(fh)
        state = check(recs)
        if state != "shifted":
            return {"ok": "follows the spec, skipped", "unknown": "nothing to tell from, skipped"}[state]
        if any(kind >= LAST_TYPE for _, kind, _ in recs):
            raise ValueError("has records from 0x000A up, doesn't look like the old nup's output; not changed")
        if dry_run:
            return f"needs fixing ({len(recs)} records)"
        for offset, kind, _ in recs:
            fh.seek(offset)
            fh.write(struct.pack("<H", kind + 1))
        fh.flush()
        os.fsync(fh.fileno())
        if check(records(fh)) != "ok":
            raise ValueError("check after fixing failed")
        return f"fixed ({len(recs)} records)"


def targets(args):
    for arg in args:
        if os.path.isdir(arg):
            for root, dirs, files in os.walk(arg):
                dirs[:] = sorted(d for d in dirs if not d.startswith("."))
                for name in sorted(files):
                    if name.lower().endswith(".nup") and not name.startswith("."):
                        yield os.path.join(root, name)
        else:
            yield arg


def main():
    args = sys.argv[1:]
    if not args or "-h" in args or "--help" in args:
        print(__doc__.strip())
        return 0 if args else 1
    dry_run = "--dry-run" in args
    paths = list(targets(a for a in args if a != "--dry-run"))
    if not paths:
        print("No .nup files found")
        return 1
    failed = 0
    for path in paths:
        try:
            print(f"{path}: {fix(path, dry_run)}")
        except (OSError, ValueError, struct.error) as error:
            failed += 1
            print(f"{path}: ✘ {error}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
