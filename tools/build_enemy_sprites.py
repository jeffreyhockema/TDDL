#!/usr/bin/env python
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.
"""
Repacks the CraftPix top-down character packs into game-ready enemy atlases.

Why this exists
---------------
The source packs are ~2.6 GB. A single character's "PNG Sequences" folder is
330 frames of 480x480 (840x720 for the big ones), roughly 14-21 MB per
character -- about 650 MB for the 42 characters. None of that can ship to a
browser, so the raw art stays outside the repo and this script bakes it down to
one atlas per character plus a manifest the game reads at runtime.

What it produces
----------------
    sprites/enemies/manifest.json     index of every character + animation
    sprites/enemies/<slug>.png        one dense atlas per character

The atlases are git-ignored. The game reads them from sprites/enemies.pak and
sprites/enemies-extra.pak, which tools/pack_assets.py rebuilds from them when
this script finishes (unless --out sent the output elsewhere).

Each atlas holds every frame of every animation at a uniform cell size, packed
left-to-right / top-to-bottom. The manifest records, per animation and
direction, the start index and frame count, so the game can address a frame as
(index % columns, index // columns).

Framing
-------
Frames are cropped to the union of all the character's non-transparent pixels,
so nothing is ever clipped -- an attack that swings a weapon well outside the
idle silhouette still fits. The *scale* is instead derived from the idle pose,
so every character's standing body is the same height regardless of how far its
attacks reach or how large its source canvas was. The manifest carries the
resulting body size and the ground anchor, letting the game scale a sprite from
an enemy's collision radius and plant it on the floor correctly.

Usage
-----
    python tools/build_enemy_sprites.py --source "<path to sprite packs>"
    python tools/build_enemy_sprites.py --only assassin,minotaur --body-height 64
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

# --------------------------------------------------------------------------
# Source layout
# --------------------------------------------------------------------------

DEFAULT_SOURCE = Path(
    r"C:\Users\icebu\Documents\~Projects\~Resources\Top-Down Enemy Sprites"
)

# CraftPix names folders "<View> - <Action>", except the death animation which
# is viewless. Views map onto the game's four facing directions.
DIRECTIONS = {
    "front": "down",
    "back": "up",
    "left": "left",
    "right": "right",
}

# Action names are not quite consistent across packs: the archer packs animate a
# bow draw as "Shooting" rather than "Attacking", and the Cyclops ships its
# idle-variation folder as "Idle Walking". Both are the same animation slot as
# far as the game is concerned.
ACTIONS = {
    "idle": "idle",
    "idle blinking": "idle_blink",
    "idle walking": "idle_blink",
    "walking": "walk",
    "running": "run",
    "attacking": "attack",
    "shooting": "attack",
    "hurt": "hurt",
}

# Playback speed per animation, in frames of animation per second. Baked into
# the manifest so timing is data, not a constant buried in the renderer.
FRAME_RATES = {
    "idle": 10,
    "idle_blink": 10,
    "walk": 14,
    "run": 18,
    "attack": 16,
    "hurt": 14,
    "dying": 12,
}

# Animations that play once and stop rather than cycling.
ONE_SHOT = ["attack", "hurt", "dying"]

# Order animations are packed in. Stable ordering keeps rebuilds deterministic.
ANIM_ORDER = ["idle", "idle_blink", "walk", "run", "attack", "hurt", "dying"]
DIR_ORDER = ["down", "up", "left", "right"]


def slugify(name: str) -> str:
    """Turns a character folder name into a filesystem/JSON friendly key."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


# --------------------------------------------------------------------------
# Source discovery
# --------------------------------------------------------------------------


def parse_animation_folder(folder: str):
    """
    Maps a source animation folder name onto (action, direction).

    Returns None for folders that aren't animations we understand, so a pack
    shipping something unexpected is skipped with a warning instead of
    corrupting the atlas.
    """
    name = folder.strip()

    if name.lower() == "dying":
        return ("dying", "all")

    if " - " not in name:
        return None

    view, _, action = name.partition(" - ")
    direction = DIRECTIONS.get(view.strip().lower())
    action_key = ACTIONS.get(action.strip().lower())

    if direction is None or action_key is None:
        return None

    return (action_key, direction)


def discover_characters(source: Path):
    """Yields (pack, character, sequences_dir) for every character in the packs."""
    for pack in sorted(os.listdir(source)):
        pack_dir = source / pack
        if not pack_dir.is_dir() or pack == "__MACOSX":
            continue

        for character in sorted(os.listdir(pack_dir)):
            char_dir = pack_dir / character
            if not char_dir.is_dir() or character == "__MACOSX":
                continue

            sequences = char_dir / "PNG" / "PNG Sequences"
            if sequences.is_dir():
                yield pack, character, sequences


def collect_frames(sequences: Path):
    """
    Builds {(action, direction): [frame paths]} for one character.

    Frames are sorted by filename, which is how CraftPix orders them
    (`Front - Walking_000.png`, `_001.png`, ...).
    """
    frames = {}
    skipped = []

    for folder in sorted(os.listdir(sequences)):
        anim_dir = sequences / folder
        if not anim_dir.is_dir():
            continue

        key = parse_animation_folder(folder)
        if key is None:
            skipped.append(folder)
            continue

        paths = sorted(p for p in anim_dir.glob("*.png") if p.is_file())
        if paths:
            frames[key] = paths

    return frames, skipped


# --------------------------------------------------------------------------
# Image helpers
# --------------------------------------------------------------------------


def union_box(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def resize_rgba(image: Image.Image, size) -> Image.Image:
    """
    Downscales an RGBA image without dark fringing.

    Fully transparent pixels in these packs carry black RGB. Resampling the
    colour channels independently of alpha averages that black into the edges of
    the sprite, leaving a dark halo -- very visible at the 5x reduction we do
    here. Premultiplying before the resample and dividing back out afterwards
    keeps edge colour correct.
    """
    src = np.asarray(image, dtype=np.float32) / 255.0
    alpha = src[:, :, 3:4]
    premultiplied = np.concatenate([src[:, :, :3] * alpha, alpha], axis=2)

    scaled = Image.fromarray(
        (premultiplied * 255.0 + 0.5).astype(np.uint8), "RGBA"
    ).resize(size, Image.LANCZOS)

    out = np.asarray(scaled, dtype=np.float32) / 255.0
    out_alpha = out[:, :, 3:4]
    # Where alpha is ~0 the colour is meaningless; leave it black rather than
    # dividing by a near-zero denominator and amplifying noise.
    safe = np.where(out_alpha > 1e-4, out_alpha, 1.0)
    rgb = np.clip(out[:, :, :3] / safe, 0.0, 1.0)

    result = np.concatenate([rgb, out_alpha], axis=2)
    return Image.fromarray((result * 255.0 + 0.5).astype(np.uint8), "RGBA")


def sample_indices(count: int, limit: int):
    """
    Picks up to `limit` evenly spaced frame indices out of `count`.

    A 20-frame walk cycle is more temporal resolution than a 60px sprite can
    show. Dropping to every other frame halves the atlas with no visible
    difference, and evenly spaced sampling keeps the cycle's timing intact.
    """
    if limit <= 0 or count <= limit:
        return list(range(count))
    return [round(i * count / limit) for i in range(limit)]


# --------------------------------------------------------------------------
# Per-character build
# --------------------------------------------------------------------------


def measure(frames, sample_limits):
    """
    First pass: finds the crop box and the idle body box.

    Returns (crop_box, idle_box, selection) where `selection` is the frame paths
    actually kept, after sampling. Only the kept frames are measured, so the
    crop box always matches what gets packed.
    """
    crop = None
    idle = None
    selection = {}

    for key, paths in frames.items():
        action, _ = key
        indices = sample_indices(len(paths), sample_limits.get(action, 0))
        kept = [paths[i] for i in indices]
        selection[key] = kept

        for path in kept:
            with Image.open(path) as image:
                box = image.convert("RGBA").getbbox()

            crop = union_box(crop, box)
            if action == "idle":
                idle = union_box(idle, box)

    # A character with no idle animation would leave the body size undefined;
    # fall back to the overall extent so the build still produces something.
    return crop, (idle or crop), selection


def build_character(
    pack, character, sequences, out_dir, body_height, sample_limits, colors
):
    frames, skipped = collect_frames(sequences)
    if not frames:
        return None, [f"{character}: no usable animations"]

    warnings = [f"{character}: ignored source folder {s!r}" for s in skipped]

    crop, idle, selection = measure(frames, sample_limits)
    if crop is None:
        return None, warnings + [f"{character}: every frame is empty"]

    crop_w = crop[2] - crop[0]
    crop_h = crop[3] - crop[1]
    idle_w = idle[2] - idle[0]
    idle_h = idle[3] - idle[1]

    # Scale so the standing body is `body_height` tall. Characters drawn on a
    # larger source canvas (the bosses) come out the same size as everyone else;
    # the game scales them back up from their collision radius at draw time.
    scale = body_height / idle_h
    cell_w = max(1, round(crop_w * scale))
    cell_h = max(1, round(crop_h * scale))

    # Total frames, and a roughly square atlas to keep the texture friendly.
    total = sum(len(v) for v in selection.values())
    columns = max(1, round(math.sqrt(total * cell_h / cell_w)))
    rows = math.ceil(total / columns)

    atlas = Image.new("RGBA", (columns * cell_w, rows * cell_h), (0, 0, 0, 0))

    animations = {}
    index = 0

    for action in ANIM_ORDER:
        for direction in ["all"] + DIR_ORDER:
            key = (action, direction)
            if key not in selection:
                continue

            paths = selection[key]
            animations.setdefault(action, {})[direction] = [index, len(paths)]

            for path in paths:
                with Image.open(path) as image:
                    frame = image.convert("RGBA").crop(crop)

                cell = resize_rgba(frame, (cell_w, cell_h))
                atlas.paste(
                    cell,
                    ((index % columns) * cell_w, (index // columns) * cell_h),
                )
                index += 1

    # These are flat, cel-shaded sprites, so a 256-colour palette is visually
    # indistinguishable from full RGBA (mean channel error under 1/255) while
    # cutting the atlas to roughly a fifth of its size. That difference decides
    # whether the whole collection is a ~40 MB download or an ~8 MB one.
    atlas_path = out_dir / f"{slugify(character)}.png"
    if colors:
        atlas = atlas.quantize(colors=colors, method=Image.FASTOCTREE)
    atlas.save(atlas_path, optimize=True)

    entry = {
        "name": character,
        "pack": pack,
        "file": atlas_path.name,
        "frameWidth": cell_w,
        "frameHeight": cell_h,
        "columns": columns,
        "frameCount": total,
        # Where the character's feet sit inside a cell. The renderer puts this
        # point on the enemy's ground position so sprites don't drift when an
        # animation's silhouette is wider than the idle pose.
        "anchorX": round((idle[0] + idle_w / 2 - crop[0]) * scale, 2),
        "anchorY": round((idle[3] - crop[1]) * scale, 2),
        # Idle silhouette size, in atlas pixels. The game divides by this to
        # scale a character to whatever size its enemy type should be.
        "bodyWidth": round(idle_w * scale, 2),
        "bodyHeight": round(idle_h * scale, 2),
        "animations": animations,
    }

    return entry, warnings


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "sprites" / "enemies",
    )
    parser.add_argument(
        "--body-height",
        type=int,
        default=64,
        help="Height in atlas pixels of the idle silhouette (default: 64)",
    )
    parser.add_argument(
        "--only",
        default="",
        help="Comma-separated slugs to rebuild instead of the whole collection",
    )
    parser.add_argument(
        "--max-walk", type=int, default=10, help="Frame cap for walk/idle cycles"
    )
    parser.add_argument(
        "--colors",
        type=int,
        default=256,
        help="Palette size for the atlas PNGs; 0 keeps full RGBA (default: 256)",
    )
    args = parser.parse_args(argv)

    if not args.source.is_dir():
        parser.error(f"source not found: {args.source}")

    # Long cycles are sampled down; short ones (attack, hurt, death) are kept
    # whole because every frame carries a distinct pose.
    sample_limits = {
        "idle": args.max_walk,
        "idle_blink": args.max_walk,
        "walk": args.max_walk,
        "run": args.max_walk,
        "attack": 0,
        "hurt": 0,
        "dying": 0,
    }

    only = {s.strip() for s in args.only.split(",") if s.strip()}
    args.out.mkdir(parents=True, exist_ok=True)

    manifest_path = args.out / "manifest.json"
    characters = {}
    # A partial rebuild keeps the entries it isn't touching.
    if only and manifest_path.exists():
        characters = json.loads(manifest_path.read_text("utf-8")).get("characters", {})

    all_warnings = []
    started = time.time()
    built = 0

    for pack, character, sequences in discover_characters(args.source):
        slug = slugify(character)
        if only and slug not in only:
            continue

        entry, warnings = build_character(
            pack,
            character,
            sequences,
            args.out,
            args.body_height,
            sample_limits,
            args.colors,
        )
        all_warnings.extend(warnings)

        if entry is None:
            continue

        characters[slug] = entry
        built += 1
        size_kb = (args.out / entry["file"]).stat().st_size / 1024
        print(
            f"  {slug:24s} {entry['frameCount']:4d} frames  "
            f"{entry['frameWidth']}x{entry['frameHeight']} cells  {size_kb:7.0f} KB"
        )

    if not built:
        print("Nothing built -- check --source and --only.", file=sys.stderr)
        return 1

    manifest = {
        "version": 1,
        "generator": "tools/build_enemy_sprites.py",
        "source": "CraftPix top-down character packs",
        "bodyHeight": args.body_height,
        "frameRates": FRAME_RATES,
        "oneShot": ONE_SHOT,
        "directions": DIR_ORDER,
        "characters": dict(sorted(characters.items())),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", "utf-8")

    total_kb = sum(
        (args.out / c["file"]).stat().st_size for c in characters.values()
    ) / 1024

    print(f"\n{built} characters built in {time.time() - started:.0f}s")
    print(f"{len(characters)} in manifest, {total_kb / 1024:.1f} MB of atlases")

    for warning in all_warnings:
        print(f"  warning: {warning}", file=sys.stderr)

    # The atlases are git-ignored; the game reads them from the enemy packs.
    from pack_assets import repack_after_build
    repack_after_build("enemies", args.out, Path(__file__).resolve().parent.parent / "sprites" / "enemies")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
