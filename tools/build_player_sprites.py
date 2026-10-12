#!/usr/bin/env python
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.
"""
Repacks the CraftPix zombie-TDS man into the player atlas, as Doom's marine.

Why version_2
-------------
The pack ships the same 16 animations twice. Under `PNG Animations` each
animation folder has its own tightly-cropped canvas -- 349x423 for one idle,
368x638 for the gun shot, 874x826 for the bat swing -- with nothing recording
how those crops relate to each other. Frames within a folder line up, but
switching animation would jump, and there is no reliable way to recover the
alignment.

`PNG_Bodyparts&Animations_version_2` is the same artwork on a uniform 512x512
canvas, so every frame of every animation shares one coordinate space. That is
what this script reads.

What it produces
----------------
    sprites/player/manifest.json      index of both characters + animations
    sprites/player/<slug>.png         one dense atlas per character

The atlas is git-ignored. The game reads it from sprites/player.pak, which
tools/pack_assets.py rebuilds from it when this script finishes (unless --out
sent the output elsewhere).

These are top-down (bird's eye) sprites: one facing, rotated at draw time to
point wherever the player aims. Everything below exists to find the point they
should rotate about.

The pivot
---------
The sprite rotates about the centre of the character's body, found from the art
rather than assumed: pixels opaque in almost every frame are the head and
shoulders, since limbs and weapons swing between frames and drop out of that
mask. The centre of what survives lands on the middle of the head for both
characters, which is the point a person viewed from directly above turns around.

An earlier version put the pivot's X on the *weapon* axis -- the line the muzzle
flash and flame lie on -- so that the barrel stayed exactly on the aim ray. That
line runs down the character's extended arm, so the sprite visibly swung around
its own shoulder when turning. Bullets are spawned along the aim ray from the
player's position regardless, so the only thing that choice bought was the
muzzle lining up with them; the cost was the character orbiting its arm. The
weapon now sits a little to one side of the aim ray, which is how someone
holding a weapon in front of them looks from above.

The muzzle flash
----------------
The attack frames of every firing weapon have a muzzle flash -- or, for the
flamethrower, a metre of flame -- painted in. Those are stripped at build time
(see strip_flash in sprite_recolor.py) and the game draws its own at the muzzle
instead: one that matches the projectile's colour, only appears on the frame
that fires, and throws a little light. The muzzle position itself is measured
from the *unstripped* frames, since the flash is how it is found.

The muzzle
----------
Each firing weapon's muzzle is measured too, from its own flash, and recorded as
an offset from the pivot. The character holds a weapon out to one side, so shots
leaving the player's centre visibly miss the barrel; the game rotates this offset
with the sprite and spawns projectiles there instead. See find_muzzles().

Usage
-----
    python tools/build_player_sprites.py --source "<path to the pack>"
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

from sprite_recolor import (
    recolour, strip_flash, flash_mask, barrel_tip, FLASH_ABOVE_REACH,
    doomguy, head_from_face,
)

DEFAULT_SOURCE = Path(
    r"C:\Users\icebu\Documents\~Projects\~Resources\Top-Down Player Sprites"
    r"\craftpix-722561-zombie-tds-main-characters"
)

ANIMATIONS_SUBPATH = Path("Characters") / "PNG_Bodyparts&Animations_version_2" / "PNG Animations"

# Source folder -> character key.
# Only the man ships: he is recoloured into Doom's marine (see doomguy in
# sprite_recolor.py). The pack's girl is not built.
CHARACTERS = {"Man": "man"}

# The pack's folder names are inconsistent across characters -- "Idle_Bat" and
# "Idle_bat", "Idle_Knife_" with a trailing underscore, "Walk_firethrower" and
# the Girl's "Walk_FireThrhrower". Weapons are matched on a substring of the
# lowercased name instead of an exact table.
WEAPON_PATTERNS = [
    ("bat", "bat"),
    ("knife", "knife"),
    ("riffle", "rifle"),
    ("rifle", "rifle"),
    ("fire", "flamethrower"),
    ("flame", "flamethrower"),
    ("gun", "pistol"),
]

# Attack animations are named after the weapon alone, with no "Attack" prefix.
ATTACK_FOLDERS = {
    "bat": "bat",
    "knife": "knife",
    "gun_shot": "pistol",
    "riffle": "rifle",
    "flamethrower": "flamethrower",
}

# Playback speed per animation kind, in animation frames per second.
FRAME_RATES = {"idle": 10, "walk": 14, "attack": 18, "death": 10}

# Animations that play once and stop.
ONE_SHOT = ["attack", "death"]

# The pack has one heavy two-handed weapon, the flamethrower. The game needs
# four, and gets them by recolouring it (see sprite_recolor.py): these sets are
# generated from the flamethrower's frames rather than read from disk, and they
# share its muzzle since the recolour moves nothing.
VARIANT_SOURCE = "flamethrower"
VARIANT_SETS = {
    "flamethrower_black": "black",
    "flamethrower_blue": "blue",
    "flamethrower_green": "green",
}

WEAPON_ORDER = [
    "pistol", "rifle",
    "flamethrower", "flamethrower_black", "flamethrower_blue", "flamethrower_green",
    "bat", "knife",
]
KIND_ORDER = ["idle", "walk", "attack"]

# Weapons that swing rather than fire, so have no muzzle to find.
MELEE_WEAPONS = {"bat", "knife"}

# A frame needs at least this many flash pixels to be worth measuring, and a
# pixel has to sit within this many of the axis to count towards the near edge.
FLASH_MIN_PIXELS = 40
AXIS_TOLERANCE = 22


def weapon_from(text: str):
    """Matches a weapon key out of a folder name fragment."""
    lowered = text.lower()
    for needle, weapon in WEAPON_PATTERNS:
        if needle in lowered:
            return weapon
    return None


def parse_animation_folder(folder: str):
    """
    Maps a source folder name onto (kind, weapon).

    `death` has no weapon and returns (death, None). Unrecognised folders return
    None so the caller can warn rather than silently mispack them.
    """
    name = folder.strip().strip("_").lower()

    if name.startswith("death"):
        return ("death", None)

    for prefix, kind in (("idle_", "idle"), ("walk_", "walk")):
        if name.startswith(prefix):
            weapon = weapon_from(name[len(prefix):])
            return (kind, weapon) if weapon else None

    if name in ATTACK_FOLDERS:
        return ("attack", ATTACK_FOLDERS[name])

    weapon = weapon_from(name)
    return ("attack", weapon) if weapon else None


def union_box(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def resize_rgba(image: Image.Image, size) -> Image.Image:
    """
    Downscales an RGBA image without dark fringing.

    Transparent pixels carry black RGB, which bleeds into the edges when colour
    is resampled independently of alpha. Premultiplying first and dividing back
    out afterwards keeps edge colour correct.
    """
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


def measure(frames):
    """
    First pass over a character's frames.

    Returns (crop, body_box):
      crop      union of every non-transparent pixel, so nothing is ever clipped
      body_box  pixels opaque in ~every frame -- the head and shoulders

    The body box is what the sprite rotates about. Limbs and weapons swing
    between frames, so they drop out of an "opaque nearly always" mask; what
    survives is the mass at the centre of the character, and from directly above
    that is the head. Its bounding box centre lands on the crown of the head for
    both characters.
    """
    crop = None
    stable = []      # alpha masks, for finding what never moves

    for (kind, _weapon), paths in frames.items():
        for path in paths:
            with Image.open(path) as opened:
                image = opened.convert("RGBA")
                alpha = np.asarray(image, dtype=np.uint8)[:, :, 3] > 128
                crop = union_box(crop, image.getbbox())

            # Death drops the character to the floor, so it would wreck an
            # "always opaque" body estimate.
            if kind != "death":
                stable.append(alpha)

    if crop is None:
        return None, None

    presence = np.stack(stable).mean(0)
    body = presence > 0.92
    ys, xs = np.nonzero(body)
    body_box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

    return crop, body_box


def find_muzzles(frames, body_box):
    """
    Locates each firing weapon's muzzle, from its own muzzle flash.

    The flash is the one thing in these sprites that is both very bright and
    strongly warm, and it only appears in the attack animations -- so it can be
    picked out by colour. Two passes, because a single one is not robust:

      1. The axis, as the median X of every flash pixel across every frame of
         the animation. A median ignores a warm highlight on a sleeve or a patch
         of lit skin; sampling the flash's leading edge directly does not, and
         put the Girl's pistol muzzle on her forearm.
      2. The near edge, taken only from pixels sitting on that axis. The flash
         starts at the barrel and travels away from the character, so its
         closest point is the muzzle -- not its centre, which for a flamethrower
         is most of a metre down the flame.

    Only the region below the body is considered: the source art fires straight
    down, so nothing above the shoulders can be a muzzle.

    @returns {dict} weapon -> (x, y) in source pixels
    """
    muzzles = {}
    body_bottom = body_box[3]

    for (kind, weapon), paths in frames.items():
        if kind != "attack" or weapon in MELEE_WEAPONS:
            continue

        masks = []
        mask_paths = []
        for path in paths:
            with Image.open(path) as opened:
                px = np.asarray(opened.convert("RGBA"), dtype=np.int16)

            r, g, b, a = px[:, :, 0], px[:, :, 1], px[:, :, 2], px[:, :, 3]
            flash = (a > 200) & (r > 205) & ((r - b) > 90) & (g > 90)
            flash[: body_bottom + 6, :] = False
            if flash.sum() >= FLASH_MIN_PIXELS:
                masks.append(flash)
                mask_paths.append(path)

        if not masks:
            continue

        axis = float(np.median(np.concatenate([np.nonzero(m)[1] for m in masks])))

        # Take the near edge from the frame with the most flash in it.
        best_i = max(range(len(masks)), key=lambda i: masks[i].sum())
        ys, xs = np.nonzero(masks[best_i])
        on_axis = np.abs(xs - axis) < AXIS_TOLERANCE
        if on_axis.sum() < 10:
            continue

        muzzles[weapon] = (axis, float(np.percentile(ys[on_axis], 2)), mask_paths[best_i])

    return muzzles


def build_character(source_dir, character, out_dir, body_width, colors):
    frames = {}
    warnings = []

    for folder in sorted(os.listdir(source_dir)):
        anim_dir = source_dir / folder
        if not anim_dir.is_dir():
            continue

        key = parse_animation_folder(folder)
        if key is None:
            warnings.append(f"{character}: ignored source folder {folder!r}")
            continue

        paths = sorted(p for p in anim_dir.glob("*.png") if p.is_file())
        if paths:
            frames[key] = paths

    if not frames:
        return None, warnings + [f"{character}: no usable animations"]

    crop, body = measure(frames)
    if crop is None:
        return None, warnings + [f"{character}: every frame is empty"]

    crop_w, crop_h = crop[2] - crop[0], crop[3] - crop[1]

    # Normalise on the body so both characters play at the same size, whatever
    # the art's own proportions. Everything else -- a bat's arc, the reach of a
    # flame -- scales with it.
    scale = body_width / (body[2] - body[0])
    cell_w = max(1, round(crop_w * scale))
    cell_h = max(1, round(crop_h * scale))

    muzzles = find_muzzles(frames, body)

    # The head, for the hair: the body box is the head and shoulders seen from
    # above, so its centre is the middle of the head and its half-width a
    # little more than the head's radius.
    head_centre = ((body[0] + body[2]) / 2, (body[1] + body[3]) / 2)
    head_radius = (body[2] - body[0]) / 2 * 1.15

    # The flash's top edge locates the muzzle but is not quite the end of the
    # gun. With the flash stripped, the lowest opaque pixel on the axis is.
    flash_top = {}
    for weapon, (axis, top, path) in list(muzzles.items()):
        flash_top[weapon] = top
        with Image.open(path) as opened:
            stripped = strip_flash(opened.convert("RGBA"), body[3], top)
        tip = barrel_tip(stripped, axis, body[3])
        muzzles[weapon] = (axis, tip if tip is not None else top)

    if VARIANT_SOURCE in muzzles:
        for variant_key in VARIANT_SETS:
            muzzles[variant_key] = muzzles[VARIANT_SOURCE]
            flash_top[variant_key] = flash_top[VARIANT_SOURCE]

    # Variant sets are packed from the source weapon's frames, so they count
    # towards the atlas size the same way.
    source_frames = {k: v for k, v in frames.items() if k[1] == VARIANT_SOURCE}
    total = sum(len(v) for v in frames.values()) + len(VARIANT_SETS) * sum(
        len(v) for v in source_frames.values()
    )
    columns = max(1, round(math.sqrt(total * cell_h / cell_w)))
    rows = math.ceil(total / columns)

    atlas = Image.new("RGBA", (columns * cell_w, rows * cell_h), (0, 0, 0, 0))
    animations = {}
    index = 0

    ordered = [("death", None)] + [(k, w) for w in WEAPON_ORDER for k in KIND_ORDER]
    for key in ordered:
        kind, weapon = key

        # A recoloured set reads the flamethrower's frames and transforms them
        # on the way in; everything else reads its own.
        variant = VARIANT_SETS.get(weapon)
        source_key = (kind, VARIANT_SOURCE) if variant else key
        if source_key not in frames:
            continue

        paths = frames[source_key]
        animations.setdefault(kind, {})[weapon or "none"] = [index, len(paths)]

        # Firing weapons have their muzzle flash painted into the attack frames.
        # The game draws its own instead -- one that matches the projectile and
        # only appears on the frame that fires -- so the painted one comes out.
        # Muzzles were measured from the raw frames above, before this.
        strip = kind == "attack" and (VARIANT_SOURCE if variant else weapon) not in MELEE_WEAPONS

        line = flash_top.get(VARIANT_SOURCE if variant else weapon)
        strip = strip and line is not None

        for path in paths:
            with Image.open(path) as opened:
                frame = opened.convert("RGBA")
                if strip:
                    raw = np.asarray(frame, dtype=np.uint8)[..., 3] > 128
                    frame = strip_flash(frame, body[3], line)
                    done = np.asarray(frame, dtype=np.uint8)[..., 3] > 128

                    # Two guards. Nothing above the eraser's reach may change --
                    # that region is gun and hand, and a single lost pixel there
                    # is the start of a vanishing forearm. And below it, the
                    # flash must actually be gone.
                    guard = int(round(line)) - FLASH_ABOVE_REACH
                    if (raw[:guard] != done[:guard]).any():
                        warnings.append(
                            f"{character}: stripping touched the character above the "
                            f"flash in {path.name}"
                        )
                    leftover = int(flash_mask(frame, body[3], line).sum())
                    if leftover > 40:
                        warnings.append(
                            f"{character}: {leftover} flash pixels survived stripping in {path.name}"
                        )
                # Into Doom's marine: green armour, brown hair. The head is
                # on the pivot in every upright frame; a dying man's is found
                # from his face. This comes before a variant's recolour, whose
                # green tank the backpack rule would otherwise turn brown.
                head = head_from_face(frame) if kind == "death" else head_centre
                frame = doomguy(frame, head, head_radius)
                if variant:
                    frame = recolour(frame, variant, body[3])
                frame = frame.crop(crop)

            atlas.paste(
                resize_rgba(frame, (cell_w, cell_h)),
                ((index % columns) * cell_w, (index // columns) * cell_h),
            )
            index += 1

    atlas_path = out_dir / f"{CHARACTERS[character]}.png"
    if colors:
        atlas = atlas.quantize(colors=colors, method=Image.FASTOCTREE)
    atlas.save(atlas_path, optimize=True)

    entry = {
        "name": character,
        "file": atlas_path.name,
        "frameWidth": cell_w,
        "frameHeight": cell_h,
        "columns": columns,
        "frameCount": total,
        # The point the sprite rotates about, in cell pixels: the centre of the
        # character's body, which from this viewpoint is the middle of the head.
        "pivotX": round(((body[0] + body[2]) / 2 - crop[0]) * scale, 2),
        "pivotY": round(((body[1] + body[3]) / 2 - crop[1]) * scale, 2),
        # The body box itself, in cell pixels. Recorded so the pivot's contract --
        # that it is this box's centre -- is checkable rather than implicit; the
        # pivot drifting onto the weapon arm is exactly the bug this catches.
        "bodyX": round((body[0] - crop[0]) * scale, 2),
        "bodyY": round((body[1] - crop[1]) * scale, 2),
        # Body size in cell pixels; the game scales from this.
        "bodyWidth": round((body[2] - body[0]) * scale, 2),
        "bodyHeight": round((body[3] - body[1]) * scale, 2),
        # Where each weapon's shots leave it, as an offset from the pivot in cell
        # pixels. The renderer rotates this the same way it rotates the sprite,
        # which puts the projectile at the barrel instead of at the player's
        # centre -- the gun is held to one side, so the two are not the same
        # place. Melee weapons have no entry.
        "muzzle": {
            weapon: [
                round((mx - (body[0] + body[2]) / 2) * scale, 2),
                round((my - (body[1] + body[3]) / 2) * scale, 2),
            ]
            for weapon, (mx, my) in sorted(muzzles.items())
        },
        "animations": animations,
    }

    return entry, warnings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "sprites" / "player",
    )
    parser.add_argument(
        "--body-width",
        type=int,
        default=64,
        help="Width in atlas pixels of the character's body (default: 64)",
    )
    parser.add_argument(
        "--colors",
        type=int,
        default=256,
        help="Palette size for the atlas PNGs; 0 keeps full RGBA (default: 256)",
    )
    args = parser.parse_args(argv)

    animations_root = args.source / ANIMATIONS_SUBPATH
    if not animations_root.is_dir():
        parser.error(f"animations not found: {animations_root}")

    args.out.mkdir(parents=True, exist_ok=True)

    characters = {}
    all_warnings = []
    started = time.time()

    for folder, slug in CHARACTERS.items():
        source_dir = animations_root / folder
        if not source_dir.is_dir():
            all_warnings.append(f"missing character folder {folder!r}")
            continue

        entry, warnings = build_character(
            source_dir, folder, args.out, args.body_width, args.colors
        )
        all_warnings.extend(warnings)
        if entry is None:
            continue

        characters[slug] = entry
        size_kb = (args.out / entry["file"]).stat().st_size / 1024
        print(
            f"  {slug:8s} {entry['frameCount']:4d} frames  "
            f"{entry['frameWidth']}x{entry['frameHeight']} cells  "
            f"pivot ({entry['pivotX']},{entry['pivotY']})  {size_kb:6.0f} KB"
        )

    if not characters:
        print("Nothing built -- check --source.", file=sys.stderr)
        return 1

    manifest = {
        "version": 1,
        "generator": "tools/build_player_sprites.py",
        "source": "CraftPix zombie TDS main characters (version_2 animations)",
        "bodyWidth": args.body_width,
        # The source art aims straight down (+Y). The renderer subtracts this
        # from the player's aim angle to find how far to rotate the sprite.
        "sourceAngle": round(math.pi / 2, 6),
        "frameRates": FRAME_RATES,
        "oneShot": ONE_SHOT,
        "weapons": WEAPON_ORDER,
        "characters": characters,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", "utf-8")

    total_kb = sum((args.out / c["file"]).stat().st_size for c in characters.values()) / 1024
    print(f"\n{len(characters)} characters built in {time.time() - started:.0f}s, {total_kb:.0f} KB")

    for warning in all_warnings:
        print(f"  warning: {warning}", file=sys.stderr)

    # The atlas is git-ignored; the game reads it from the player pack.
    from pack_assets import repack_after_build
    repack_after_build("player", args.out, Path(__file__).resolve().parent.parent / "sprites" / "player")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
