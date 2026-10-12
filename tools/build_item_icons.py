#!/usr/bin/env python
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.
"""
Repacks the CraftPix zombie-TDS item art into pickup icons.

The source icons are 64x64 to 256x256 with a lot of empty margin -- the bat is
24 pixels of content in a 256-wide canvas. Each is cropped to its content and
scaled so its longest side is `--size`, which is what lets the game draw them at
a consistent weight regardless of how much padding the original had.

What it produces
----------------
    sprites/items/manifest.json     name -> file, size
    sprites/items/<name>.png        one icon per pickup

The icons are git-ignored. The game reads them from sprites/items.pak, which
tools/pack_assets.py rebuilds from them when this script finishes (unless --out
sent the output elsewhere).

Only the icons the game actually uses are baked. The pack also ships armour,
money, and three power-up icons; add them here when something uses them.

Usage
-----
    python tools/build_item_icons.py --source "<path to the pack>"
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from sprite_recolor import recolour

DEFAULT_SOURCE = Path(
    r"C:\Users\icebu\Documents\~Projects\~Resources\Top-Down Player Sprites"
    r"\craftpix-722561-zombie-tds-main-characters"
)

ITEMS_SUBPATH = Path("Items") / "PNG_version_2"

# Game name -> (source file, recolour variant or None). The pack's filenames are
# opaque, so the mapping is spelled out rather than pattern-matched: items_0000
# is the assault rifle and items_0014 the pistol, which a name match would not
# get right.
#
# The pack has one heavy weapon, the flamethrower. Four of the game's weapons
# are drawn with it, told apart by colour (see sprite_recolor.py), and their
# ammunition follows the same scheme: the fuel cylinder, in each weapon's colour.
ICONS = {
    "knife": ("items_0015_knife.png", None),
    "pistol": ("items_0014_gun.png", None),
    "shotgun": ("items_0001_fire.png", None),
    "rifle": ("items_0000_gun.png", None),
    "rocketlauncher": ("items_0001_fire.png", "black"),
    "plasmagun": ("items_0001_fire.png", "blue"),
    "bfg": ("items_0001_fire.png", "green"),
    "health": ("items_0005_health.png", None),
    "ammo_pistol": ("items_0003_magazine_gun.png", None),
    "ammo_rifle": ("items_0004_magazine_riffle.png", None),
    "ammo_shotgun": ("items_0012_cylinder.png", None),
    "ammo_rocket": ("items_0012_cylinder.png", "black"),
    "ammo_plasma": ("items_0012_cylinder.png", "blue"),
    "ammo_bfg": ("items_0012_cylinder.png", "green"),
}


def resize_rgba(image: Image.Image, size) -> Image.Image:
    """Downscales without the dark fringe that resampling colour through
    transparent black pixels would leave around the edges."""
    src = np.asarray(image, dtype=np.float32) / 255.0
    alpha = src[:, :, 3:4]
    premultiplied = np.concatenate([src[:, :, :3] * alpha, alpha], axis=2)

    scaled = Image.fromarray(
        (premultiplied * 255.0 + 0.5).astype(np.uint8), "RGBA"
    ).resize(size, Image.LANCZOS)

    out = np.asarray(scaled, dtype=np.float32) / 255.0
    out_alpha = out[:, :, 3:4]
    safe = np.where(out_alpha > 1e-4, out_alpha, 1.0)
    rgb = np.clip(out[:, :, :3] / safe, 0.0, 1.0)

    return Image.fromarray(
        (np.concatenate([rgb, out_alpha], axis=2) * 255.0 + 0.5).astype(np.uint8), "RGBA"
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "sprites" / "items",
    )
    parser.add_argument(
        "--size", type=int, default=64, help="Longest side, in pixels (default: 64)"
    )
    args = parser.parse_args(argv)

    items_root = args.source / ITEMS_SUBPATH
    if not items_root.is_dir():
        parser.error(f"items not found: {items_root}")

    args.out.mkdir(parents=True, exist_ok=True)

    icons = {}
    missing = []
    started = time.time()

    for name, (filename, variant) in ICONS.items():
        source = items_root / filename
        if not source.is_file():
            missing.append(filename)
            continue

        with Image.open(source) as opened:
            image = opened.convert("RGBA")
            if variant:
                image = recolour(image, variant, None, icon=True)
            box = image.getbbox()
            if box:
                image = image.crop(box)

            longest = max(image.width, image.height)
            scale = args.size / longest
            image = resize_rgba(
                image, (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
            )

        path = args.out / f"{name}.png"
        image.save(path, optimize=True)

        icons[name] = {
            "file": path.name,
            "width": image.width,
            "height": image.height,
            "source": filename,
            "variant": variant,
        }
        print(f"  {name:20s} {image.width:3d}x{image.height:<3d}  {path.stat().st_size / 1024:5.1f} KB")

    if not icons:
        print("Nothing built -- check --source.", file=sys.stderr)
        return 1

    manifest = {
        "version": 1,
        "generator": "tools/build_item_icons.py",
        "source": "CraftPix zombie TDS items (PNG_version_2)",
        "size": args.size,
        "icons": icons,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", "utf-8")

    total_kb = sum((args.out / i["file"]).stat().st_size for i in icons.values()) / 1024
    print(f"\n{len(icons)} icons built in {time.time() - started:.0f}s, {total_kb:.0f} KB")

    for filename in missing:
        print(f"  warning: source file not found: {filename}", file=sys.stderr)

    # The icons are git-ignored; the game reads them from the icon pack.
    from pack_assets import repack_after_build
    repack_after_build("items", args.out, Path(__file__).resolve().parent.parent / "sprites" / "items")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
