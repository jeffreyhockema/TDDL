#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.
"""
Bundles the built art and sound into the scrambled asset packs the game ships.

    python tools/pack_assets.py              # rebuild every pack
    python tools/pack_assets.py sounds       # just one group

Why this exists
---------------
The sprites are CraftPix art and the sounds the Doom Sound Bulb pack. Neither is
the project's to hand out as loose files, yet a static site has to send them to
every browser. So the repository holds packs instead of PNGs and WAVs: a few
binary files whose contents are scrambled, so they cannot be browsed, previewed
or right-click-saved one by one.

This is obfuscation, not security. The key is a constant here and in
js/asset-pack.js, and anyone determined can read it there. The point is only
that the art is no longer one click away.

Inputs and outputs
------------------
The build tools write the raw files; this reads them and writes the packs:

    sprites/player/*.png    ->  sprites/player.pak
    sprites/items/*.png     ->  sprites/items.pak
    sprites/enemies/*.png   ->  sprites/enemies.pak        (the characters the
                                sprites/enemies-extra.pak   bestiary wears, and
                                                            the rest)
    sounds/*.wav            ->  sounds/sounds.pak

The raw files are git-ignored; only the packs and the JSON manifests are
committed. Each build tool calls this for its own group when it finishes, so a
rebuild leaves the packs current without a second step.

The enemies are split because the game only ever draws the ~17 characters
js/monsters.js names, out of 52 in the collection. One pack of everything would
make every phone download three times the art it needs; the extra pack is only
fetched if the roster names a character the main pack lacks -- a build that has
fallen behind js/monsters.js -- so that case still works, just slower.

Format (version 1), all integers little-endian
----------------------------------------------
    0   4  magic "TDPK"
    4   1  format version (1)
    5   3  reserved, zero
    8   4  size of the whole pack in bytes
    12  4  length of the index in bytes
    16  4  CRC-32 of the plain index
    20  .. the index, scrambled
    ..  .. every entry's data, scrambled, back to back in index order

The index is UTF-8 JSON: a list of {"crc", "length", "name", "offset", "type"}
sorted by name, where `offset` is from the start of the pack and `crc` is the
CRC-32 of the entry's plain bytes, so a damaged pack is caught rather than
handed to the image decoder.

Scrambling XORs the bytes with a keystream from xorshift32, seeded per entry
from the key and a hash of the entry's name -- so no two entries share a
pattern, and a PNG's well-known header does not give the key away for the rest.
WAVs are not compressed first: 16-bit PCM deflates by only ~7%, not worth a
dependency on DecompressionStream.

Deterministic: the same inputs always give byte-identical packs, so an
unchanged rebuild leaves nothing for git to commit. test/asset-pack.test.mjs
re-encodes every committed pack in JavaScript and checks it comes out
identical, which keeps this file and js/asset-pack.js agreeing on the format.

Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import zlib
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent

MAGIC = b"TDPK"
VERSION = 1
HEADER_SIZE = 20

# The scrambling key. Must match PACK_KEY in js/asset-pack.js.
KEY = 0x7DD1A55E

# The index is scrambled under this name, which no entry can have (entry names
# are file names).
INDEX_SEED_NAME = ":index"

MIME_TYPES = {".png": "image/png", ".wav": "audio/wav"}

MASK = 0xFFFFFFFF


# =============================================================================
# SCRAMBLING -- mirrored in js/asset-pack.js
# =============================================================================

def fnv1a32(text: str) -> int:
    """FNV-1a over the name's UTF-8 bytes: a cheap, well-spread name hash."""
    h = 0x811C9DC5
    for byte in text.encode("utf-8"):
        h = ((h ^ byte) * 0x01000193) & MASK
    return h


def fmix32(h: int) -> int:
    """MurmurHash3's finaliser, so similar names give unrelated seeds."""
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & MASK
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & MASK
    h ^= h >> 16
    return h


def seed_for(name: str) -> int:
    """The keystream seed for one entry. xorshift32 must never be seeded 0."""
    return fmix32(KEY ^ fnv1a32(name)) or 1


def keystream(seed: int, length: int) -> bytes:
    """
    `length` bytes of xorshift32 output: each step's 32-bit state, little-endian.

    Pure Python manages a few million steps a second, which is fine for the
    ~12 MB the packs hold.
    """
    words = array("I", bytes((length + 3) // 4 * 4))
    x = seed
    for i in range(len(words)):
        x ^= (x << 13) & MASK
        x ^= x >> 17
        x ^= (x << 5) & MASK
        words[i] = x
    if sys.byteorder != "little":
        words.byteswap()
    return words.tobytes()[:length]


def scramble(data: bytes, name: str) -> bytes:
    """XORs data with its entry's keystream. Its own inverse."""
    if not data:
        return b""
    stream = keystream(seed_for(name), len(data))
    # One big-integer XOR is far faster than a Python loop over bytes.
    mixed = int.from_bytes(data, "little") ^ int.from_bytes(stream, "little")
    return mixed.to_bytes(len(data), "little")


# =============================================================================
# PACKING
# =============================================================================

def encode_pack(entries: list[tuple[str, str, bytes]]) -> bytes:
    """
    Builds a pack from (name, mime type, bytes) triples.

    Entries are sorted by name, and the index JSON is written with sorted keys
    and no whitespace, so the output depends only on the inputs.
    """
    entries = sorted(entries, key=lambda e: e[0])
    names = [name for name, _, _ in entries]
    if len(set(names)) != len(names):
        raise ValueError("duplicate entry names")
    for name in names:
        if not name or not name.isascii() or name == INDEX_SEED_NAME:
            raise ValueError(f"bad entry name: {name!r}")

    # The index's length depends on the offsets, which depend on the index's
    # length. Offsets only ever grow as the index does, so a couple of passes
    # always settles.
    index_length = 0
    while True:
        offset = HEADER_SIZE + index_length
        records = []
        for name, mime, data in entries:
            records.append({
                "crc": zlib.crc32(data),
                "length": len(data),
                "name": name,
                "offset": offset,
                "type": mime,
            })
            offset += len(data)
        index = json.dumps(records, sort_keys=True, separators=(",", ":")).encode("ascii")
        if len(index) == index_length:
            break
        index_length = len(index)

    total = HEADER_SIZE + len(index) + sum(len(data) for _, _, data in entries)
    header = MAGIC + struct.pack("<B3xIII", VERSION, total, len(index), zlib.crc32(index))

    parts = [header, scramble(index, INDEX_SEED_NAME)]
    parts.extend(scramble(data, name) for name, _, data in entries)
    pack = b"".join(parts)
    assert len(pack) == total
    return pack


def decode_pack(pack: bytes) -> dict[str, bytes]:
    """
    Reads a pack back. Used to check every pack just written; the game's own
    decoder is js/asset-pack.js.
    """
    if len(pack) < HEADER_SIZE or pack[:4] != MAGIC:
        raise ValueError("not an asset pack")
    version, total, index_length, index_crc = struct.unpack("<B3xIII", pack[4:HEADER_SIZE])
    if version != VERSION or total != len(pack):
        raise ValueError("wrong version or size")
    index = scramble(pack[HEADER_SIZE:HEADER_SIZE + index_length], INDEX_SEED_NAME)
    if zlib.crc32(index) != index_crc:
        raise ValueError("index checksum mismatch")
    out = {}
    for record in json.loads(index):
        start, length = record["offset"], record["length"]
        data = scramble(pack[start:start + length], record["name"])
        if zlib.crc32(data) != record["crc"]:
            raise ValueError(f"{record['name']}: checksum mismatch")
        out[record["name"]] = data
    return out


# =============================================================================
# THE PACKS
# =============================================================================

def roster() -> set[str]:
    """
    The enemy characters the game draws: every `sprite:` named in
    js/monsters.js. Read from the source so there is one list, as
    tools/build_sounds.py does with SAMPLE_NAMES.
    """
    source = (ROOT / "js" / "monsters.js").read_text("utf-8")
    slugs = set(re.findall(r"\bsprite:\s*'([a-z0-9-]+)'", source))
    if not slugs:
        sys.exit("could not find any `sprite:` entries in js/monsters.js")
    return slugs


@dataclass
class Pack:
    """One output pack: where it goes, what it reads, and which of those."""
    out: str
    folder: str
    pattern: str
    keep: Callable[[Path], bool] = lambda path: True


def groups() -> dict[str, list[Pack]]:
    """Packs by group name -- the unit the build tools rebuild."""
    wanted = roster()
    return {
        "player": [Pack("sprites/player.pak", "sprites/player", "*.png")],
        "items": [Pack("sprites/items.pak", "sprites/items", "*.png")],
        "enemies": [
            Pack("sprites/enemies.pak", "sprites/enemies", "*.png",
                 lambda path: path.stem in wanted),
            Pack("sprites/enemies-extra.pak", "sprites/enemies", "*.png",
                 lambda path: path.stem not in wanted),
        ],
        "sounds": [Pack("sounds/sounds.pak", "sounds", "*.wav")],
    }


def write_pack(pack: Pack) -> None:
    """Builds one pack from its raw files, checks it reads back, and writes it."""
    folder = ROOT / pack.folder
    files = sorted(p for p in folder.glob(pack.pattern) if pack.keep(p))
    if not files:
        sys.exit(f"{pack.out}: no {pack.pattern} files in {pack.folder}/ -- run the build tools first")

    entries = [(p.name, MIME_TYPES[p.suffix.lower()], p.read_bytes()) for p in files]
    data = encode_pack(entries)

    unpacked = decode_pack(data)
    if unpacked != {name: blob for name, _, blob in entries}:
        sys.exit(f"{pack.out}: did not read back identically")

    out = ROOT / pack.out
    changed = not out.exists() or out.read_bytes() != data
    if changed:
        out.write_bytes(data)
    raw = sum(len(blob) for _, _, blob in entries)
    print(f"  {pack.out:28s} {len(entries):3d} files  {raw / 1024:8.0f} KB raw  "
          f"{len(data) / 1024:8.0f} KB packed  {'written' if changed else 'unchanged'}")


def pack_groups(names: list[str]) -> None:
    """Rebuilds the named groups' packs."""
    table = groups()
    for name in names:
        for pack in table[name]:
            write_pack(pack)


def repack_after_build(group: str, out_dir: Path, default_dir: Path) -> None:
    """
    Called by a build tool once it has written its raw files.

    Only repacks when the tool wrote to its usual folder: a build sent
    somewhere else with --out is a trial run, and the packs should keep
    reflecting what is in the usual folder.
    """
    if Path(out_dir).resolve() != Path(default_dir).resolve():
        print(f"\nPacks not rebuilt: output went to {out_dir}, not {default_dir}.")
        return
    print("\nRebuilding packs:")
    pack_groups([group])


def main(argv=None) -> int:
    names = list(groups())
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("groups", nargs="*", metavar="GROUP",
                        help=f"groups to rebuild: {', '.join(names)} (default: all)")
    args = parser.parse_args(argv)
    unknown = [name for name in args.groups if name not in names]
    if unknown:
        parser.error(f"unknown group(s): {', '.join(unknown)}; choose from {', '.join(names)}")
    pack_groups(args.groups or names)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
