#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.
"""
Extracts the game's sound effects from a Doom sound WAD and its extras PK3.

    python tools/build_sounds.py --source "<folder with Doom_Sound_Bulb.wad and .pk3>"

Which lumps to take is decided by SAMPLE_NAMES in js/audio-system.js, read from
the source so there is exactly one list: the game fetches what it names, this
tool ships what it names, and `npm test` fails on any name without a file or
any file without a name.

Lumps are written to sounds/ as lowercase .wav files, verbatim. The WAD stores
each sound as a complete RIFF/WAVE file, so no conversion is involved; the PK3
is a zip with a SOUNDS/ directory of the same.

The .wav files are git-ignored. What the game downloads is sounds/sounds.pak,
which tools/pack_assets.py builds from them; this script rebuilds it at the end.

Stdlib only.
"""

import argparse
import io
import re
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "sounds"
SYSTEM = ROOT / "js" / "audio-system.js"


def sample_names():
    """The lump list from audio-system.js, lowercase and in order."""
    source = SYSTEM.read_text(encoding="utf-8")
    match = re.search(r"export const SAMPLE_NAMES = \[(.*?)\];", source, re.S)
    if not match:
        sys.exit("SAMPLE_NAMES not found in js/audio-system.js")
    body = re.sub(r"//[^\n]*", "", match.group(1))
    return re.findall(r"'([a-z0-9_]+)'", body)


def read_wad(path):
    """All non-empty lumps of a WAD, as {lowercase name: bytes}."""
    data = path.read_bytes()
    ident, count, offset = struct.unpack("<4sII", data[:12])
    if ident not in (b"IWAD", b"PWAD"):
        sys.exit(f"{path} is not a WAD")
    lumps = {}
    for i in range(count):
        at = offset + 16 * i
        pos, size, name = struct.unpack("<II8s", data[at:at + 16])
        if size == 0:
            continue
        lumps[name.rstrip(b"\0").decode("ascii").lower()] = data[pos:pos + size]
    return lumps


def read_pk3(path):
    """All .wav entries of a PK3, as {lowercase stem: bytes}."""
    lumps = {}
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if info.filename.lower().endswith(".wav"):
                stem = Path(info.filename).stem.lower()
                lumps[stem] = archive.read(info.filename)
    return lumps


def wav_summary(blob):
    """'44100Hz 16bit mono 1.2s', or None if the blob is not a RIFF WAVE."""
    if blob[:4] != b"RIFF" or blob[8:12] != b"WAVE":
        return None
    channels, rate = struct.unpack("<HI", blob[22:28])
    byte_rate, = struct.unpack("<I", blob[28:32])
    bits, = struct.unpack("<H", blob[34:36])
    # Walk to the data chunk for the length.
    at = 12
    while at + 8 <= len(blob):
        chunk, size = blob[at:at + 4], struct.unpack("<I", blob[at + 4:at + 8])[0]
        if chunk == b"data":
            return f"{rate}Hz {bits}bit {'mono' if channels == 1 else 'stereo'} {size / byte_rate:.2f}s"
        at += 8 + size + (size & 1)
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, help="folder containing the .wad and .pk3")
    parser.add_argument("--wad", default="Doom_Sound_Bulb.wad")
    parser.add_argument("--pk3", default="Doom_Sound_Bulb_Extras.pk3")
    parser.add_argument("--clean", action="store_true", help="remove .wav files in sounds/ that are not named")
    args = parser.parse_args()

    source = Path(args.source)
    lumps = read_wad(source / args.wad)
    pk3_path = source / args.pk3
    if pk3_path.exists():
        # Extras override the WAD where both have a name: the PK3 is the newer set.
        lumps.update(read_pk3(pk3_path))
    else:
        print(f"note: no {args.pk3}, extras unavailable")

    names = sample_names()
    OUT.mkdir(exist_ok=True)

    missing, written = [], 0
    for name in names:
        blob = lumps.get(name)
        if blob is None:
            missing.append(name)
            continue
        summary = wav_summary(blob)
        if summary is None:
            missing.append(f"{name} (not a WAV)")
            continue
        (OUT / f"{name}.wav").write_bytes(blob)
        written += 1
        print(f"  {name:10s} {len(blob) // 1024:4d}k  {summary}")

    if args.clean:
        for stray in OUT.glob("*.wav"):
            if stray.stem not in names:
                stray.unlink()
                print(f"  removed {stray.name}")

    total = sum((OUT / f"{n}.wav").stat().st_size for n in names if (OUT / f"{n}.wav").exists())
    print(f"\n{written} of {len(names)} sounds written to {OUT} ({total / 1024 / 1024:.1f} MB)")
    if missing:
        sys.exit("missing from the source: " + ", ".join(missing))

    # The .wav files are git-ignored; the game reads them from the sound pack.
    from pack_assets import repack_after_build
    repack_after_build("sounds", OUT, OUT)


if __name__ == "__main__":
    main()
