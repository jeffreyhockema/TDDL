# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.
"""
Recolours the flamethrower artwork into the other heavy weapons.

The sprite pack has one big two-handed weapon: a flamethrower with a red fuel
tank and an orange flame. The game needs four -- shotgun, rocket launcher,
plasma gun and BFG -- and has art for none of them, so the flamethrower stands
in for all four, recoloured per weapon. The shotgun uses it untouched; the
others get the tank and the flame remapped:

    black   dark metal tank, and the flame greys out into a launch flash
    blue    blue tank, blue plasma
    green   green tank, green flame, and a glow around both

Isolating the weapon from the character
---------------------------------------
Nothing in the pack separates weapon from body, so it is done by colour, and two
things make that work:

  * The tank is the only strongly red thing on the man, and on the girl the only
    other red is a tattoo on her far arm -- a thin swirl a fraction of the tank's
    size. Keeping only the largest connected red region leaves the tank and
    drops the tattoo, without any assumptions about where either sits.

  * The flame shares its orange-yellow hue with the khaki uniform, so hue alone
    would recolour the character's clothes. Flame is far brighter than cloth,
    and -- because the source art always fires straight down -- it is always
    below the body. Brightness plus position picks it out with only a few stray
    highlight pixels on the body, which are too small to see.

The same functions serve both the player atlases and the pickup icons.
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

# Hue thresholds, in degrees. Red wraps around zero.
RED_MAX = 16
RED_MIN = 335
FLAME_HUE = (16, 62)

# Saturation / value floors for the two masks.
TANK_SAT, TANK_VAL = 0.35, 0.15
FLAME_SAT, FLAME_VAL = 0.5, 0.85

# Every recolour the game knows about, keyed by the suffix it will be filed under.
VARIANTS = {
    "black": {
        "tank": {"hue": None, "sat": 0.08, "val": 0.32},
        "flame": {"hue": None, "sat": 0.12, "val": 1.0},
        "glow": None,
    },
    "blue": {
        "tank": {"hue": 215, "sat": 1.0, "val": 1.0},
        "flame": {"hue": "+190", "sat": 1.0, "val": 1.0},
        "glow": None,
    },
    "green": {
        "tank": {"hue": 120, "sat": 1.0, "val": 1.05},
        "flame": {"hue": "+100", "sat": 1.0, "val": 1.05},
        "glow": {"color": (90, 255, 120), "radius": 10, "strength": 0.55},
    },
}


# ---------------------------------------------------------------------------
# Colour space
# ---------------------------------------------------------------------------


def rgb_to_hsv(rgb: np.ndarray):
    """Vectorised RGB (0..1) -> H (degrees), S, V."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    safe = np.maximum(d, 1e-6)

    h = np.where(
        mx == r, (g - b) / safe,
        np.where(mx == g, 2 + (b - r) / safe, 4 + (r - g) / safe),
    ) * 60
    h = np.where(d > 1e-6, (h + 360) % 360, 0)
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def hsv_to_rgb(h: np.ndarray, s: np.ndarray, v: np.ndarray):
    """Vectorised H (degrees), S, V -> RGB (0..1)."""
    h = (h % 360) / 60
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))

    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], axis=-1)


# ---------------------------------------------------------------------------
# Masks
# ---------------------------------------------------------------------------


def weapon_masks(image: Image.Image, body_bottom: int | None, icon: bool = False):
    """
    Finds the tank and the flame.

    @param image        RGBA frame
    @param body_bottom  Y below which flame is looked for; None to search the
                        whole image
    @param icon         True for a pickup icon: there is no character to protect,
                        so every warm saturated pixel is treated as weapon --
                        which also catches the orange fuel canister that a
                        red-only mask would leave behind
    @returns (tank, flame) boolean masks
    """
    px = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    opaque = px[..., 3] > 0.5
    h, s, v = rgb_to_hsv(px[..., :3])

    if icon:
        warm = opaque & ((h < FLAME_HUE[1]) | (h > RED_MIN)) & (s > TANK_SAT) & (v > TANK_VAL)
        return warm, np.zeros_like(warm)

    red = opaque & ((h < RED_MAX) | (h > RED_MIN)) & (s > TANK_SAT) & (v > TANK_VAL)

    # Largest connected red region only: drops the girl's tattoo and any stray
    # red pixels, keeps the tank.
    labels, count = ndimage.label(red)
    tank = np.zeros_like(red)
    if count:
        sizes = ndimage.sum(red, labels, index=np.arange(1, count + 1))
        tank = labels == (int(np.argmax(sizes)) + 1)

    flame = (
        opaque
        & (h >= FLAME_HUE[0]) & (h < FLAME_HUE[1])
        & (s > FLAME_SAT) & (v > FLAME_VAL)
    )
    if body_bottom is not None:
        flame[: body_bottom + 4, :] = False

    # The flame's root, right at the nozzle, is red-hot rather than orange and
    # would otherwise fall into neither mask.
    if body_bottom is not None:
        hot_root = red & ~tank
        hot_root[: body_bottom + 4, :] = False
        flame |= hot_root

    return tank, flame


# ---------------------------------------------------------------------------
# Muzzle flash removal
# ---------------------------------------------------------------------------

# Hue band treated as "warm" when growing the flash region: everything from red
# through yellow. Near-white glow pixels have no meaningful hue, so brightness
# is accepted in its place.
WARM_MAX_HUE = 62
FLASH_GROW_SAT = 0.4
FLASH_SOFT_ALPHA = 0.97
FLASH_BRIGHT = 0.7

# How far above the flash's measured top edge the eraser may reach, in source
# pixels. Enough for a pistol flash's upward spikes; nowhere near a forearm.
FLASH_ABOVE_REACH = 60

# Half-width of the band around the firing axis used to find the barrel tip.
BARREL_BAND = 14


def flash_mask(image: Image.Image, body_bottom: int, muzzle_y: float) -> np.ndarray:
    """
    Finds the muzzle flash (or flame) baked into an attack frame.

    Colour alone cannot do this. The flame's darker orange body, the character's
    skin and the khaki sleeve all overlap in hue, saturation and brightness, and
    on the pistol the flash physically touches the hand. A first version grew the
    region from any bright warm pixel through any warm or soft-edged one, and
    walked straight up the forearm -- the man's whole left arm vanished on every
    rifle shot.

    What actually separates flash from character is *where it is*: the flash's
    top edge on the firing axis is measured before this runs (see find_muzzles
    in the player builder), and everything above that line is gun and hand. So:

      * the region's seed -- opaque, saturated, near-white-hot -- must sit at or
        below that line, which rules out a highlight on a knuckle or a grip;
      * below the line it may grow through anything warm-and-saturated or any
        bright or warm soft-edged pixel (the grey barrel's own anti-aliased
        outline is dark, so it no longer offers a path);
      * above the line, for a short reach only, it may grow through glow fringe
        or white-hot pixels alone -- never through opaque mid-brightness pixels,
        which is what skin and cloth are;
      * beyond that reach it may not grow at all.

    @param image        RGBA attack frame
    @param body_bottom  Y of the bottom of the body box, in source pixels
    @param muzzle_y     Y of the flash's top edge on the firing axis
    """
    px = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    a = px[..., 3]
    h, s, v = rgb_to_hsv(px[..., :3])
    rows = np.arange(a.shape[0])[:, None]

    warm = (h < WARM_MAX_HUE) | (h > RED_MIN)
    visible = a > 0.02
    soft = visible & (a < FLASH_SOFT_ALPHA)
    opaque = visible & ~soft
    hot = opaque & warm & (s > FLAME_SAT) & (v > FLAME_VAL)
    glow = soft & (warm | (v > FLASH_BRIGHT))

    line = int(round(muzzle_y))
    at_flash = (rows >= line - 4) & (rows > body_bottom + 4)
    near_flash = (rows >= line - FLASH_ABOVE_REACH) & (rows > body_bottom + 4) & ~at_flash

    core = hot & at_flash
    grow = (at_flash & ((warm & visible & (s > FLASH_GROW_SAT)) | glow)) | (near_flash & (hot | glow))

    region = core | grow
    labels, count = ndimage.label(region)
    if not count:
        return np.zeros_like(region)

    seeded = np.unique(labels[core])
    seeded = seeded[seeded > 0]
    flash = np.isin(labels, seeded)

    # A pixel or two outward so no dim ring of glow is left around the hole --
    # only into soft or warm pixels, never into the barrel or a hand.
    ring = ndimage.binary_dilation(flash, iterations=2) & ~flash
    flash |= ring & (at_flash | near_flash) & (glow | (warm & visible & (s > 0.3)))

    return flash


def strip_flash(image: Image.Image, body_bottom: int, muzzle_y: float) -> Image.Image:
    """Returns a copy of an attack frame with its muzzle flash made transparent."""
    mask = flash_mask(image, body_bottom, muzzle_y)
    px = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    px[mask] = 0
    return Image.fromarray(px, "RGBA")


def barrel_tip(image: Image.Image, axis_x: float, body_bottom: int):
    """
    Finds the end of the gun: the lowest opaque pixel on the firing axis.

    Run on a *stripped* frame, so the only thing left on the axis below the body
    is the weapon itself. The flash's top edge, which is how the muzzle is first
    located, sits a little short of the tip for a rifle and a little past it for
    a pistol's halo; this is the point a flash should actually emanate from.

    @returns Y in source pixels, or None if nothing opaque is on the axis
    """
    a = np.asarray(image.convert("RGBA"), dtype=np.uint8)[..., 3]
    x0 = max(0, int(axis_x - BARREL_BAND))
    x1 = min(a.shape[1], int(axis_x + BARREL_BAND) + 1)
    band = a[body_bottom + 4:, x0:x1] > 128
    ys = np.nonzero(band.any(axis=1))[0]
    if ys.size == 0:
        return None
    return float(body_bottom + 4 + ys.max())


# ---------------------------------------------------------------------------
# Recolour
# ---------------------------------------------------------------------------


def _apply(h, s, v, mask, rule):
    """Applies one hue/sat/val rule inside a mask, in place."""
    if not mask.any():
        return

    hue = rule["hue"]
    if isinstance(hue, str):
        # Relative shift: keeps the flame's own gradient from red root to yellow
        # tip, just moved around the wheel.
        h[mask] = (h[mask] + float(hue)) % 360
    elif hue is not None:
        h[mask] = hue

    if rule["sat"] != 1.0:
        s[mask] = np.clip(s[mask] * rule["sat"] if rule["hue"] is not None else rule["sat"], 0, 1)
    if rule["val"] != 1.0:
        v[mask] = np.clip(v[mask] * rule["val"], 0, 1)


def recolour(
    image: Image.Image, variant: str, body_bottom: int | None, icon: bool = False
) -> Image.Image:
    """
    Produces one recoloured copy of a flamethrower frame or icon.

    @param image        RGBA source
    @param variant      Key into VARIANTS
    @param body_bottom  See weapon_masks()
    @param icon         See weapon_masks()
    """
    spec = VARIANTS[variant]
    tank, flame = weapon_masks(image, body_bottom, icon)

    px = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    h, s, v = rgb_to_hsv(px[..., :3])

    _apply(h, s, v, tank, spec["tank"])
    _apply(h, s, v, flame, spec["flame"])

    rgb = hsv_to_rgb(h, s, v)
    out = np.concatenate([rgb, px[..., 3:4]], axis=-1)
    result = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")

    if spec["glow"]:
        result = _add_glow(result, tank | flame, spec["glow"])

    return result


def _add_glow(image: Image.Image, mask: np.ndarray, glow: dict) -> Image.Image:
    """
    Puts a soft coloured halo behind the masked region.

    The halo is composited *under* the sprite, so it only shows past the edges;
    the weapon itself is already recoloured and stays crisp.
    """
    alpha = (mask.astype(np.float32) * 255 * glow["strength"]).astype(np.uint8)
    halo = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(glow["radius"]))

    layer = Image.new("RGBA", image.size, glow["color"] + (0,))
    layer.putalpha(halo)

    out = layer.copy()
    out.alpha_composite(image)
    return out


# ---------------------------------------------------------------------------
# Doomguy
# ---------------------------------------------------------------------------
#
# The pack's man wears a khaki uniform, a green backpack and black hair. Doom's
# marine wears green armour and has brown hair, so the man is recoloured on
# the way into the atlas: the uniform's hue is moved to Doom's armour green
# with its own shading kept, the backpack is turned brown so it still reads
# as a separate thing on a green back, and the hair is lifted from black to
# brown. Skin, leather straps, boots and weapons are left alone.
#
# The hair is the one part that cannot be told by colour -- it is painted in
# the same near-blacks as the boots and the trousers -- so it is found by
# where it is: the dark blob at the head. Seen from above the head sits on
# the pivot in every standing frame; in the death frames the body lies
# sprawled and the head is found from the face instead.

# Doom's armour green, and the marine's hair
ARMOUR_HUE = 100
ARMOUR_SAT = 1.0
ARMOUR_VAL = 0.74
BACKPACK = {"hue": 28, "sat": 0.55, "val": 0.85}
HAIR_HUE = 22
HAIR_SAT = 0.62
HAIR_VAL_LIFT = 0.30       # Black hair is lifted to this before its own shading is added

KHAKI_HUE = (40, 64)
KHAKI_MIN_SAT = 0.42
KHAKI_MIN_VAL = 0.12
# The uniform's deepest shading drifts down to hue 30, where the rifle's wooden
# stock also lives; the shading is much darker than the wood, so that band
# counts only when it is dark
KHAKI_SHADOW_HUE = (28, 40)
KHAKI_SHADOW_MAX_VAL = 0.27
PACK_HUE = (80, 125)
PACK_MIN_SAT = 0.25
DARK_MAX_SAT = 0.4
DARK_MAX_VAL = 0.34
SKIN_HUE = (12, 42)
SKIN_SAT = (0.3, 0.8)
SKIN_MIN_VAL = 0.55


def _components(mask: np.ndarray):
    """Labels 4-connected components of a boolean mask. Returns (labels, sizes)."""
    labels = np.zeros(mask.shape, dtype=np.int32)
    sizes = []
    h, w = mask.shape
    current = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if labels[y0, x0]:
            continue
        current += 1
        stack = [(y0, x0)]
        labels[y0, x0] = current
        size = 0
        while stack:
            y, x = stack.pop()
            size += 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = current
                    stack.append((ny, nx))
        sizes.append(size)
    return labels, sizes


def head_from_face(image: Image.Image):
    """
    The head's centre in a frame where the body is not upright: the middle of
    the largest patch of skin, which is the face. Returns None if no skin.
    """
    px = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    h, s, v = rgb_to_hsv(px[..., :3])
    skin = (px[..., 3] > 0.5) & (h >= SKIN_HUE[0]) & (h <= SKIN_HUE[1]) & \
           (s >= SKIN_SAT[0]) & (s <= SKIN_SAT[1]) & (v >= SKIN_MIN_VAL)
    if not skin.any():
        return None
    labels, sizes = _components(skin)
    biggest = int(np.argmax(sizes)) + 1
    ys, xs = np.nonzero(labels == biggest)
    return float(xs.mean()), float(ys.mean())


def doomguy(image: Image.Image, head, head_radius: float) -> Image.Image:
    """
    Recolours one frame of the man into Doom's marine.

    @param image        RGBA source frame
    @param head         (x, y) of the head's centre in the frame, or None to
                        leave the hair alone
    @param head_radius  How far from that centre the hair may reach
    """
    px = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    alpha = px[..., 3] > 0.5
    h, s, v = rgb_to_hsv(px[..., :3])

    # The uniform: khaki to armour green, shading kept
    khaki = alpha & (h >= KHAKI_HUE[0]) & (h <= KHAKI_HUE[1]) & (s >= KHAKI_MIN_SAT) & (v >= KHAKI_MIN_VAL)
    khaki |= alpha & (h >= KHAKI_SHADOW_HUE[0]) & (h < KHAKI_HUE[0]) & (s >= KHAKI_MIN_SAT) &              (v >= KHAKI_MIN_VAL) & (v <= KHAKI_SHADOW_MAX_VAL)
    h[khaki] = ARMOUR_HUE
    s[khaki] = np.clip(s[khaki] * ARMOUR_SAT, 0, 1)
    v[khaki] = np.clip(v[khaki] * ARMOUR_VAL, 0, 1)

    # The backpack: its own green to leather brown, so it still stands out
    pack = alpha & (h >= PACK_HUE[0]) & (h <= PACK_HUE[1]) & (s >= PACK_MIN_SAT) & ~khaki
    h[pack] = BACKPACK["hue"]
    s[pack] = np.clip(s[pack] * BACKPACK["sat"] / 0.4, 0, 1)
    v[pack] = np.clip(v[pack] * BACKPACK["val"], 0, 1)

    # The hair: the dark blob at the head, lifted to brown
    if head is not None:
        cx, cy = head
        dark = alpha & (s <= DARK_MAX_SAT) & (v <= DARK_MAX_VAL)
        ys, xs = np.indices(dark.shape)
        near = dark & (np.hypot(xs - cx, ys - cy) <= head_radius)
        if near.any():
            labels, sizes = _components(near)
            # Every component whose bulk lies close to the centre is hair; a
            # gun barrel clipping the edge of the circle is not
            hair = np.zeros(dark.shape, dtype=bool)
            for index, size in enumerate(sizes, start=1):
                member = labels == index
                my, mx = ys[member].mean(), xs[member].mean()
                if np.hypot(mx - cx, my - cy) <= head_radius * 0.6 and size >= 12:
                    hair |= member
            h[hair] = HAIR_HUE
            s[hair] = HAIR_SAT
            v[hair] = np.clip(HAIR_VAL_LIFT + v[hair] * 1.1, 0, 1)

    rgb = hsv_to_rgb(h, s, v)
    out = np.concatenate([rgb, px[..., 3:4]], axis=-1)
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
