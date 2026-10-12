#!/usr/bin/env python
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.
"""
Recolours built enemy atlases into Doom's monsters.

The CraftPix packs have the right *shapes* for most of Doom's bestiary -- a
goblin is an Imp's build, a squat earth-monster a Demon's, a big goblin a
Baron's -- but not the right colours, and Doom's monsters are recognised by
colour as much as by shape: the Imp is brown, the Demon pink, the Baron pink
and the Hell Knight tan, the Arch-vile yellow, the zombies green-skinned.

This script reads atlases that tools/build_enemy_sprites.py has already built
and writes recoloured copies next to them, each with its own manifest entry
that shares the source's geometry. Rules are hue bands: a cel-shaded sprite
uses a handful of hues, so "everything green becomes brown, keeping its own
shading" is a faithful way to repaint one.

Usage
-----
    python tools/build_doom_monsters.py                 # rebuild every variant
    python tools/build_doom_monsters.py --preview x.png # also write a contact sheet

Run after build_enemy_sprites.py; that script does not know about these.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sprite_recolor import rgb_to_hsv, hsv_to_rgb  # noqa: E402

# ---------------------------------------------------------------------------
# The variants
# ---------------------------------------------------------------------------
#
# Each rule matches a band of the source's colours -- hue in degrees (wrapping
# at 360), saturation and value 0..1 -- and repaints it: `hue` absolute, `sat`
# and `val` as multipliers, or `sat_abs` to set saturation outright. Rules
# apply in order to whatever earlier rules have not already claimed.

ZOMBIE_SKIN = {"hue": 95, "sat_abs": 0.32, "val": 0.92}

VARIANTS = {
    # ---------------------------------------------------------- the humans
    # Zombieman: a former human in a tan uniform, skin gone grey-green.
    "zombieman": {
        "source": "robber",
        "name": "Zombieman",
        "rules": [
            {"h": (8, 40), "s": (0.35, 0.8), "v": (0.55, 1.0), **ZOMBIE_SKIN},          # skin
            {"h": (0, 45), "s": (0.0, 0.4), "v": (0.12, 0.7), "hue": 42, "sat_abs": 0.5, "val": 1.1},  # clothes -> khaki
        ],
    },
    # Shotgun Guy: the sergeant, black uniform, the same dead skin.
    "shotgun-guy": {
        "source": "thug",
        "name": "Shotgun Guy",
        "rules": [
            {"h": (8, 40), "s": (0.35, 0.8), "v": (0.55, 1.0), **ZOMBIE_SKIN},
            {"h": (0, 60), "s": (0.0, 0.45), "v": (0.12, 0.7), "hue": 220, "sat_abs": 0.08, "val": 0.55},  # clothes -> black
        ],
    },
    # Heavy Weapon Dude: the big one in red.
    "chaingunner": {
        "source": "caveman-boss",
        "name": "Heavy Weapon Dude",
        "rules": [
            {"h": (8, 40), "s": (0.35, 0.8), "v": (0.55, 1.0), **ZOMBIE_SKIN},
            {"h": (15, 50), "s": (0.5, 1.0), "v": (0.3, 1.0), "hue": 358, "sat_abs": 0.75, "val": 0.9},  # the shirt -> red
        ],
    },
    # -------------------------------------------------------- the demons
    # Imp: brown, red-eyed. The goblin's green becomes hide-brown.
    "imp": {
        "source": "male-goblin",
        "name": "Imp",
        "rules": [
            {"h": (55, 135), "s": (0.25, 1.0), "v": (0.0, 1.0), "hue": 22, "sat": 0.85, "val": 0.82},
        ],
    },
    # Demon (and, at 28% opacity, the Spectre): the pink bull.
    "demon": {
        "source": "earth-monster",
        "name": "Demon",
        "rules": [
            {"h": (0, 45), "s": (0.3, 1.0), "v": (0.15, 1.0), "hue": 345, "sat_abs": 0.45, "val": 1.1},   # hide -> pink
            {"h": (80, 140), "s": (0.25, 1.0), "v": (0.0, 1.0), "hue": 350, "sat_abs": 0.5, "val": 0.75},  # the leafy top -> darker pink
        ],
    },
    # Lost Soul: a skull on fire. The pirate skeleton's green hair burns.
    "lost-soul": {
        "source": "pirate-skeleton",
        "name": "Lost Soul",
        "rules": [
            {"h": (55, 110), "s": (0.25, 1.0), "v": (0.35, 1.0), "hue": 28, "sat_abs": 0.95, "val": 1.35},  # hair -> flame
            {"h": (55, 110), "s": (0.2, 1.0), "v": (0.0, 0.35), "hue": 12, "sat_abs": 0.9, "val": 1.6},    # its shadow -> red root
        ],
    },
    # Baron of Hell and Hell Knight: one build, two hides -- as in Doom, where
    # the Knight is the Baron's sprite in a different colour range.
    "baron": {
        "source": "giant-goblin",
        "name": "Baron of Hell",
        "rules": [
            {"h": (45, 130), "s": (0.25, 1.0), "v": (0.0, 1.0), "hue": 8, "sat_abs": 0.42, "val": 0.95},
        ],
    },
    "hell-knight": {
        "source": "giant-goblin",
        "name": "Hell Knight",
        "rules": [
            {"h": (45, 130), "s": (0.25, 1.0), "v": (0.0, 1.0), "hue": 42, "sat_abs": 0.5, "val": 1.0},
        ],
    },
    # Mancubus: the fat brown one. The rock-monster's grey becomes hide.
    "mancubus": {
        "source": "rock-monster",
        "name": "Mancubus",
        "rules": [
            {"h": (0, 360), "s": (0.0, 0.4), "v": (0.2, 1.0), "hue": 25, "sat_abs": 0.55, "val": 0.78},
        ],
    },
    # Pain Elemental: brown, all mouth. The medusa's green goes rust-brown.
    "pain-elemental": {
        "source": "medusa",
        "name": "Pain Elemental",
        "rules": [
            {"h": (55, 130), "s": (0.2, 1.0), "v": (0.0, 1.0), "hue": 18, "sat_abs": 0.6, "val": 0.85},
        ],
    },
    # Arch-vile: tall, thin and yellow. Anubis's blue-black becomes bone-yellow.
    "arch-vile": {
        "source": "anubis",
        "name": "Arch-vile",
        "rules": [
            {"h": (170, 250), "s": (0.1, 1.0), "v": (0.1, 1.0), "hue": 46, "sat_abs": 0.55, "val": 1.45},
            {"h": (0, 360), "s": (0.0, 0.1), "v": (0.12, 0.6), "hue": 40, "sat_abs": 0.35, "val": 1.3},  # neutral darks lift too
        ],
    },
}


def in_band(h, lo, hi):
    """Hue band test with wrap-around at 360."""
    if lo <= hi:
        return (h >= lo) & (h <= hi)
    return (h >= lo) | (h <= hi)


def recolour_atlas(image: Image.Image, rules) -> Image.Image:
    px = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    alpha = px[..., 3] > 0.02
    h, s, v = rgb_to_hsv(px[..., :3])
    claimed = np.zeros(alpha.shape, dtype=bool)

    for rule in rules:
        mask = alpha & ~claimed & in_band(h, *rule["h"]) & \
               (s >= rule["s"][0]) & (s <= rule["s"][1]) & (v >= rule["v"][0]) & (v <= rule["v"][1])
        if not mask.any():
            continue
        if "hue" in rule:
            h[mask] = rule["hue"]
        if "sat_abs" in rule:
            s[mask] = rule["sat_abs"]
        elif "sat" in rule:
            s[mask] = np.clip(s[mask] * rule["sat"], 0, 1)
        if "val" in rule:
            v[mask] = np.clip(v[mask] * rule["val"], 0, 1)
        claimed |= mask

    rgb = hsv_to_rgb(h, s, v)
    out = np.concatenate([rgb, px[..., 3:4]], axis=-1)
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def build(out_dir: Path, colors: int, preview):
    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    characters = manifest["characters"]
    built = []

    for slug, spec in VARIANTS.items():
        source = characters.get(spec["source"])
        if source is None:
            print(f"  missing source {spec['source']!r} for {slug}", file=sys.stderr)
            continue
        with Image.open(out_dir / source["file"]) as opened:
            atlas = recolour_atlas(opened.convert("RGBA"), spec["rules"])
        if colors:
            atlas = atlas.quantize(colors=colors, method=Image.FASTOCTREE)
        file = f"{slug}.png"
        atlas.save(out_dir / file, optimize=True)

        entry = dict(source)
        entry["name"] = spec["name"]
        entry["file"] = file
        entry["doomVariantOf"] = spec["source"]
        characters[slug] = entry
        built.append(slug)
        print(f"  {slug:16s} from {spec['source']:16s} {(out_dir / file).stat().st_size // 1024} KB")

    manifest["characters"] = dict(sorted(characters.items()))
    manifest_path.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")

    if preview:
        sheet_for(out_dir, manifest, built, preview)
    return built


def sheet_for(out_dir: Path, manifest, slugs, path: Path, cell=220):
    """A contact sheet: each variant beside its source, idle and attacking."""
    chars = manifest["characters"]
    cols = 3
    rows = (len(slugs) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell * 2, rows * (cell + 18)), (50, 50, 54, 255))
    draw = ImageDraw.Draw(sheet)

    def frames(entry, which):
        image = Image.open(out_dir / entry["file"]).convert("RGBA")
        fw, fh, columns = entry["frameWidth"], entry["frameHeight"], entry["columns"]
        out = []
        for index in which:
            x, y = (index % columns) * fw, (index // columns) * fh
            out.append(image.crop((x, y, x + fw, y + fh)))
        return out

    for k, slug in enumerate(slugs):
        entry = chars[slug]
        base = chars[entry["doomVariantOf"]]
        picks = [entry["animations"]["idle"]["down"][0], entry["animations"]["attack"]["down"][0] + 4]
        strip = Image.new("RGBA", (entry["frameWidth"] * 4 + 24, entry["frameHeight"]))
        x = 0
        for image in frames(base, picks) + frames(entry, picks):
            strip.paste(image, (x, 0), image)
            x += entry["frameWidth"] + 8
        scale = min((cell * 2 - 10) / strip.width, (cell - 10) / strip.height)
        strip = strip.resize((int(strip.width * scale), int(strip.height * scale)), Image.LANCZOS)
        ox = (k % cols) * cell * 2 + (cell * 2 - strip.width) // 2
        oy = (k // cols) * (cell + 18) + (cell - strip.height) // 2
        sheet.paste(strip, (ox, oy), strip)
        draw.text(((k % cols) * cell * 2 + 4, (k // cols) * (cell + 18) + cell + 2),
                  f"{entry['doomVariantOf']} -> {slug}", fill=(255, 230, 120, 255))
    sheet.save(path)
    print(f"  preview: {path}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path,
                        default=Path(__file__).resolve().parent.parent / "sprites" / "enemies")
    parser.add_argument("--colors", type=int, default=256)
    parser.add_argument("--preview", type=Path, default=None,
                        help="Write a contact sheet of every variant beside its source to this path")
    args = parser.parse_args(argv)
    built = build(args.out, args.colors, args.preview)
    print(f"{len(built)} Doom variants built")

    # The atlases are git-ignored; the game reads them from the enemy packs.
    from pack_assets import repack_after_build
    repack_after_build("enemies", args.out, Path(__file__).resolve().parent.parent / "sprites" / "enemies")


if __name__ == "__main__":
    main()
