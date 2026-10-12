// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Player sprite and item icon checks. Run with: npm test
 *
 * Covers:
 *
 *   1. The baked player atlases -- both characters exist, and every animation
 *      the game asks for (idle/walk/attack for each of the five weapons that
 *      have art, plus death) resolves to frames inside the atlas. Atlases and
 *      icons are read out of sprites/player.pak and sprites/items.pak, as the
 *      game reads them: the loose PNGs are not in the repository.
 *
 *   2. The weapon roster's contract with the artwork. Every weapon must name a
 *      sprite animation set that actually exists, so equipping one can never
 *      leave the player holding nothing; the four heavy weapons each use
 *      their own recolour of the flamethrower art.
 *
 *   3. The item icons -- every icon a weapon or ammo type names must be baked,
 *      and the two weapons with no art must be the two that ask for none.
 *
 *   4. The player animation state machine: firing plays the attack animation and
 *      holds it past the fire rate, and no artwork degrades to shape rendering.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_FILES, packedFile, pngSize, diskFetch } from './pack-files.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const noop = () => {};
let failures = 0;

function check(label, condition, detail = '') {
    if (condition) {
        console.log(`  ok    ${label}`);
    } else {
        failures++;
        console.error(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
    }
}

// ---------------------------------------------------------------- DOM stubs
globalThis.window = globalThis;
globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, getContext: () => new Proxy({}, { get: () => noop, set: () => true }) }),
    addEventListener: noop,
    removeEventListener: noop,
};
globalThis.Image = class {
    constructor() {
        this.complete = true;
        this.naturalHeight = 64;
        this.naturalWidth = 64;
    }
    addEventListener() {}
};

// Serve the manifests and packs off disk so the suite exercises what the build produced.
globalThis.fetch = diskFetch();

const origLog = console.log;
const origWarn = console.warn;
console.log = noop;
console.warn = noop;

const sprites = await import('../js/player-sprites.js');
const icons = await import('../js/item-icons.js');
const { WEAPON_STATS, PLAYER_SPRITE_BODY_PER_RADIUS } = await import('../js/constants.js');
const { Player } = await import('../js/entities.js');

console.log = origLog;
console.warn = origWarn;

console.log('\n=== player sprites & item icons ===\n');

// ---------------------------------------------------------------- Player atlases

const playerDir = path.join(root, 'sprites', 'player');
const manifest = JSON.parse(fs.readFileSync(path.join(playerDir, 'manifest.json'), 'utf8'));
const slugs = Object.keys(manifest.characters);

check('one player character is baked: the man', slugs.length === 1 && slugs[0] === 'man', slugs.join(', '));
check('the girl is gone', !slugs.includes('girl') && !packedFile(PACK_FILES.player, 'girl.png'));

const loaded = await sprites.loadPlayerSpriteManifest('sprites/player/manifest.json');
check('the loader accepts the generated manifest', loaded);

// The source art aims straight down; the renderer subtracts this from the aim
// angle. A wrong value here would point every weapon the wrong way.
check('the source facing is recorded as straight down',
    Math.abs(sprites.getPlayerSourceAngle() - Math.PI / 2) < 1e-3,
    String(sprites.getPlayerSourceAngle()));

const ART_WEAPONS = [
    'pistol', 'rifle',
    'flamethrower', 'flamethrower_black', 'flamethrower_blue', 'flamethrower_green',
    'bat', 'knife',
];
const KINDS = ['idle', 'walk', 'attack'];

const unresolved = [];
const outOfBounds = [];

for (const slug of slugs) {
    const meta = manifest.characters[slug];
    const atlas = packedFile(PACK_FILES.player, meta.file);

    if (!atlas) {
        unresolved.push(`${slug}: atlas missing from ${PACK_FILES.player}`);
        continue;
    }

    const { width, height } = pngSize(atlas);

    const cases = ART_WEAPONS.flatMap((w) => KINDS.map((k) => [k, w]));
    cases.push(['death', null]);

    for (const [kind, weapon] of cases) {
        const range = sprites.resolvePlayerAnimation(meta, kind, weapon);
        if (!range) {
            unresolved.push(`${slug}/${kind}/${weapon}`);
            continue;
        }
        // Every weapon with its own art must resolve to that art, not a stand-in.
        if (weapon && range.weapon !== weapon) {
            unresolved.push(`${slug}/${kind}/${weapon} resolved to ${range.weapon}`);
        }
        const rect = sprites.getPlayerFrameRect(meta, range, range.count - 1);
        if (rect.x + rect.width > width || rect.y + rect.height > height) {
            outOfBounds.push(`${slug}/${kind}/${weapon}`);
        }
    }

    // The renderer divides by bodyWidth and offsets by the pivot.
    if (!(meta.bodyWidth > 0) || !Number.isFinite(meta.pivotX) || !Number.isFinite(meta.pivotY)) {
        unresolved.push(`${slug}: unusable draw geometry`);
    }
}

check('every animation resolves for every weapon', unresolved.length === 0,
    unresolved.slice(0, 5).join(', '));
check('every frame lies inside its atlas', outOfBounds.length === 0,
    outOfBounds.slice(0, 5).join(', '));

check('a random pick returns a known character',
    slugs.includes(sprites.pickRandomPlayerCharacter()));

// The sprite is rotated about the pivot, so the pivot is where the character
// appears to turn. It must be the centre of the body box -- the head, from this
// viewpoint. Taking pivotX from the weapon axis instead put it on the extended
// arm, and the character visibly swung around its own shoulder.
{
    const offCentre = slugs.filter((slug) => {
        const c = manifest.characters[slug];
        return Math.abs(c.pivotX - (c.bodyX + c.bodyWidth / 2)) > 0.51 ||
               Math.abs(c.pivotY - (c.bodyY + c.bodyHeight / 2)) > 0.51;
    });
    check('the pivot is the centre of the body', offCentre.length === 0,
        offCentre.map((s) => {
            const c = manifest.characters[s];
            return `${s}: pivot (${c.pivotX},${c.pivotY}) vs body centre ` +
                   `(${c.bodyX + c.bodyWidth / 2},${c.bodyY + c.bodyHeight / 2})`;
        }).join('; '));

    // And the pivot must sit inside the drawn frame, not off in empty space.
    const outside = slugs.filter((slug) => {
        const c = manifest.characters[slug];
        return c.pivotX < 0 || c.pivotX > c.frameWidth ||
               c.pivotY < 0 || c.pivotY > c.frameHeight;
    });
    check('the pivot lies inside the frame', outside.length === 0, outside.join(', '));
}

// The same property, but driven through the real draw code rather than the
// manifest's arithmetic: whatever transform drawSprite sets up, the centre of
// the character's body has to land on the player's world position at every
// angle. With the pivot on the weapon arm this drifts by 8-9 pixels, which is
// the character visibly orbiting its own shoulder as it turns.
// A canvas stub that tracks the 2D transform so a point in the sprite's own cell
// coordinates can be mapped back out into the world. Shared by the pivot and
// muzzle checks, both of which need to know where a point was actually drawn.
function transformRecorder() {
        let t = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        const stack = [];
        let dest = null;
        const mul = (m) => {
            t = {
                a: t.a * m.a + t.c * m.b, b: t.b * m.a + t.d * m.b,
                c: t.a * m.c + t.c * m.d, d: t.b * m.c + t.d * m.d,
                e: t.a * m.e + t.c * m.f + t.e, f: t.b * m.e + t.d * m.f + t.f
            };
        };
        return {
            ctx: {
                save: () => stack.push({ ...t }),
                restore: () => { t = stack.pop(); },
                translate: (x, y) => mul({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }),
                rotate: (r) => mul({ a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 }),
                drawImage: (...a) => { dest = { dx: a[5], dy: a[6], t: { ...t } }; },
                set filter(v) {}, get filter() { return 'none'; },
                set globalAlpha(v) {}, get globalAlpha() { return 1; }
            },
        get dest() { return dest; }
    };
}

{
    const drift = [];
    for (const slug of slugs) {
        const p = new Player(500, 300);
        p.spriteSlug = slug;
        const meta = sprites.getPlayerSpriteMeta(slug);
        const scale = (p.radius * PLAYER_SPRITE_BODY_PER_RADIUS) / meta.bodyWidth;

        let worst = 0;
        for (let k = 0; k < 16; k++) {
            p.angle = (k * Math.PI) / 8;
            const rec = transformRecorder();
            if (!p.drawSprite(rec.ctx)) { worst = Infinity; break; }

            const lx = rec.dest.dx + (meta.bodyX + meta.bodyWidth / 2) * scale;
            const ly = rec.dest.dy + (meta.bodyY + meta.bodyHeight / 2) * scale;
            const T = rec.dest.t;
            worst = Math.max(worst, Math.hypot(
                T.a * lx + T.c * ly + T.e - p.x,
                T.b * lx + T.d * ly + T.f - p.y));
        }
        if (worst > 0.05) drift.push(`${slug}: ${worst.toFixed(2)}px`);
    }
    check('the body stays on the player position through a full turn',
        drift.length === 0, drift.join(', '));
}

// Projectiles have to leave the barrel, not the middle of the player: the
// character holds a weapon out to one side, so shots spawned at the centre
// visibly missed the gun. The muzzle offset is baked per weapon, and rotating it
// the way the sprite rotates is what keeps the two together at every angle.
{
    // These checks fire real shots, so the state the weapon code reaches for has
    // to exist; the animation section below sets it up again for its own use.
    globalThis.gameState = globalThis.gameState || { selectedDifficulty: 'medium', currentLevel: 1 };
    globalThis.gameState.bullets = [];

    const offBarrel = [];

    for (const slug of slugs) {
        for (const weaponName of ['Pistol', 'Shotgun', 'Rifle', 'Rocket Launcher', 'Plasma Gun', 'BFG']) {
            const p = new Player(500, 300);
            p.spriteSlug = slug;
            p.currentWeaponIndex = p.weapons.findIndex((w) => w.name === weaponName);

            const meta = sprites.getPlayerSpriteMeta(slug);
            const offset = meta.muzzle[p.getSpriteWeapon()];
            const scale = (p.radius * PLAYER_SPRITE_BODY_PER_RADIUS) / meta.bodyWidth;

            let worst = 0;
            for (let k = 0; k < 16; k++) {
                p.angle = (k * Math.PI) / 8;
                const rec = transformRecorder();
                if (!p.drawSprite(rec.ctx)) { worst = Infinity; break; }

                // Where the manifest's muzzle point actually got drawn...
                const lx = rec.dest.dx + (meta.pivotX + offset[0]) * scale;
                const ly = rec.dest.dy + (meta.pivotY + offset[1]) * scale;
                const T = rec.dest.t;
                const drawnX = T.a * lx + T.c * ly + T.e;
                const drawnY = T.b * lx + T.d * ly + T.f;

                // ...against where shots are spawned.
                const muzzle = p.getMuzzleWorldPosition();
                worst = Math.max(worst, Math.hypot(muzzle.x - drawnX, muzzle.y - drawnY));
            }
            if (worst > 0.05) offBarrel.push(`${slug}/${weaponName}: ${worst.toFixed(2)}px`);
        }
    }
    check('shots spawn on the drawn barrel at every angle', offBarrel.length === 0,
        offBarrel.join(', '));

    // Firing from an off-centre point along the facing angle would put every shot
    // on a line parallel to the crosshair but never through it. Shots are angled
    // at the aim point instead, so the gun still hits what it is pointed at.
    const shooter = new Player(500, 300);
    shooter.currentWeaponIndex = shooter.weapons.findIndex((w) => w.name === 'Pistol');
    let worstMiss = 0;
    for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        shooter.angle = a;
        shooter.aimX = 500 + Math.cos(a) * 300;
        shooter.aimY = 300 + Math.sin(a) * 300;

        // The pistol is hitscan now: the shot is the tracer it leaves, from the
        // barrel to wherever it stopped. Each shot is the first of its trigger
        // pull, which is the one Doom fires dead straight.
        globalThis.gameState.bullets = [];
        globalThis.gameState.temporaryVisualEffects = [];
        shooter.shootCooldown = 0;
        shooter.refireCount = 0;
        shooter.shoot();

        const b = globalThis.gameState.temporaryVisualEffects.find((e) => e.type === 'tracer');
        const angle = Math.atan2(b.endY - b.startY, b.endX - b.startX);
        // Perpendicular distance from the aim point to the shot's line of travel.
        const miss = Math.abs((shooter.aimX - b.startX) * Math.sin(angle) -
                              (shooter.aimY - b.startY) * Math.cos(angle));
        worstMiss = Math.max(worstMiss, miss);
    }
    check('a shot still passes through the aim point', worstMiss < 0.05,
        `misses by ${worstMiss.toFixed(2)}px`);

    // The sprites carry no painted muzzle flash any more; the game draws one at
    // the barrel when a projectile weapon fires, and it has to sit exactly where
    // the shot leaves, fade out on its own, and never appear for a melee swing.
    const gradient = () => ({ addColorStop: noop });
    const flashCtx = () => {
        const calls = [];
        const ctx = new Proxy({}, {
            get: (t, prop) => {
                if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
                    return (...args) => { calls.push([prop, args]); return gradient(); };
                }
                return (...args) => { calls.push([prop, args]); };
            },
            set: () => true,
        });
        return { ctx, calls };
    };

    const gunner = new Player(500, 300);
    gunner.currentWeaponIndex = gunner.weapons.findIndex((w) => w.name === 'Pistol');
    gunner.angle = 0.7;
    gunner.aimX = 500 + Math.cos(0.7) * 300;
    gunner.aimY = 300 + Math.sin(0.7) * 300;
    globalThis.gameState.bullets = [];
    gunner.shootCooldown = 0;
    gunner.shoot();

    const flash = gunner.getMuzzleFlash();
    const muzzle = gunner.getMuzzleWorldPosition();
    check('firing a projectile weapon lights a muzzle flash', !!flash && gunner.muzzleFlashTimer > 0);
    check('the flash sits on the barrel',
        !!flash && Math.hypot(flash.x - muzzle.x, flash.y - muzzle.y) < 0.01,
        flash ? `${(flash.x - muzzle.x).toFixed(2)},${(flash.y - muzzle.y).toFixed(2)}` : 'no flash');

    const { ctx, calls } = flashCtx();
    gunner.drawMuzzleFlash(ctx);
    const translated = calls.find(([name]) => name === 'translate');
    check('the flash is drawn at the barrel',
        !!translated && Math.hypot(translated[1][0] - muzzle.x, translated[1][1] - muzzle.y) < 0.01);
    check('the flash is drawn additively',
        calls.some(([name]) => name === 'createRadialGradient') &&
        calls.some(([name]) => name === 'fill'));

    // It burns out on its own.
    for (let i = 0; i < 60; i++) gunner.update();
    check('the flash fades after its frames', gunner.getMuzzleFlash() === null && gunner.muzzleFlashTimer === 0);

    // A swing is not a shot.
    gunner.currentWeaponIndex = gunner.weapons.findIndex((w) => w.name === 'Knife');
    gunner.shootCooldown = 0;
    gunner.shoot();
    check('a melee swing shows no muzzle flash', gunner.getMuzzleFlash() === null);

    // Every projectile weapon declares one; melee declares none.
    const wrong = Object.entries(WEAPON_STATS).filter(([, w]) =>
        w.isMelee ? !!w.muzzleFlash : !(w.muzzleFlash && w.muzzleFlash.frames > 0 && w.muzzleFlash.color));
    check('every projectile weapon has a muzzle flash and no melee weapon does',
        wrong.length === 0, wrong.map(([n]) => n).join(', '));
}

// ---------------------------------------------------------------- Weapon roster

const weaponNames = Object.keys(WEAPON_STATS);
check('the roster is the seven Doom-style weapons',
    weaponNames.join(', ') === 'Knife, Pistol, Shotgun, Rifle, Rocket Launcher, Plasma Gun, BFG',
    weaponNames.join(', '));

const manMeta = manifest.characters.man;
const badAnimation = [];
const missingSpriteWeapon = [];

for (const [name, stats] of Object.entries(WEAPON_STATS)) {
    if (!stats.spriteWeapon) {
        missingSpriteWeapon.push(name);
        continue;
    }
    // Every weapon must produce a drawable pose, whether from its own art or a
    // stand-in; a null here would leave the player holding nothing.
    for (const kind of KINDS) {
        if (!sprites.resolvePlayerAnimation(manMeta, kind, stats.spriteWeapon)) {
            badAnimation.push(`${name}/${kind}`);
        }
    }
}

check('every weapon names an animation set', missingSpriteWeapon.length === 0,
    missingSpriteWeapon.join(', '));
check('every weapon resolves to a drawable pose', badAnimation.length === 0,
    badAnimation.slice(0, 5).join(', '));

// The four heavy weapons are all drawn with the flamethrower art, told apart by
// colour. Each must land on its own recolour, not fall through to the original.
for (const [name, set] of [
    ['Shotgun', 'flamethrower'],
    ['Rocket Launcher', 'flamethrower_black'],
    ['Plasma Gun', 'flamethrower_blue'],
    ['BFG', 'flamethrower_green'],
]) {
    const resolved = sprites.resolvePlayerAnimation(
        manMeta, 'attack', WEAPON_STATS[name].spriteWeapon);
    check(`${name} draws with ${set}`, resolved && resolved.weapon === set, resolved?.weapon);
}

// The recolours are generated from the flamethrower's frames, so they must be
// frame-for-frame identical in length, and fire from the same muzzle.
for (const set of ['flamethrower_black', 'flamethrower_blue', 'flamethrower_green']) {
    const same = ['idle', 'walk', 'attack'].every((kind) =>
        manMeta.animations[kind][set][1] === manMeta.animations[kind].flamethrower[1]);
    const muzzle = JSON.stringify(manMeta.muzzle[set]) === JSON.stringify(manMeta.muzzle.flamethrower);
    check(`${set} matches the flamethrower frame-for-frame`, same && muzzle);
}

// ---------------------------------------------------------------- Item icons

const iconDir = path.join(root, 'sprites', 'items');
const iconManifest = JSON.parse(fs.readFileSync(path.join(iconDir, 'manifest.json'), 'utf8'));
const baked = new Set(Object.keys(iconManifest.icons));

check('the icon manifest is loadable', await icons.loadItemIcons('sprites/items/manifest.json'));

const missingIcons = [];
for (const [name, stats] of Object.entries(WEAPON_STATS)) {
    for (const key of ['icon', 'ammoIcon']) {
        if (stats[key] && !baked.has(stats[key])) {
            missingIcons.push(`${name}.${key}=${stats[key]}`);
        }
    }
}
check('every icon a weapon names is baked', missingIcons.length === 0, missingIcons.join(', '));

const missingFiles = Object.entries(iconManifest.icons)
    .filter(([, icon]) => !packedFile(PACK_FILES.items, icon.file))
    .map(([name]) => name);
check('every icon is in the icon pack', missingFiles.length === 0, missingFiles.join(', '));

// Every weapon has a pickup icon now; nothing falls back to a badge.
const withoutIcon = Object.entries(WEAPON_STATS)
    .filter(([, stats]) => !stats.icon).map(([name]) => name);
check('every weapon has a pickup icon', withoutIcon.length === 0, withoutIcon.join(', '));

check('the health pickup has an icon', baked.has('health'));

// ---------------------------------------------------------------- Animation

globalThis.gameState = { selectedDifficulty: 'medium', currentLevel: 1 };

const player = new Player(100, 100);
check('the player is assigned a character', slugs.includes(player.spriteSlug));
check('the player starts with the knife and pistol',
    player.weapons.filter((w) => w.owned).map((w) => w.name).sort().join(', ') === 'Knife, Pistol',
    player.weapons.filter((w) => w.owned).map((w) => w.name).join(', '));

check('the equipped weapon selects its animation set',
    player.getSpriteWeapon() === 'pistol', player.getSpriteWeapon());

player.playAttackAnimation();
check('firing plays the attack animation', player.animation === 'attack');

// The rifle fires every 4 updates but its animation is longer than that, so the
// hold has to outlast the fire rate or the swing would restart forever.
const rifleRate = WEAPON_STATS.Rifle.fireRate;
for (let i = 0; i < rifleRate; i++) player.updateAnimation();
check('the attack outlasts the fastest weapon\'s fire rate',
    player.animation === 'attack', `still ${player.animation} after ${rifleRate} updates`);

for (let i = 0; i < 120; i++) player.updateAnimation();
check('the attack ends once it is done', player.animation !== 'attack', player.animation);

player.isMoving = true;
player.updateAnimation();
check('moving plays the walk animation', player.animation === 'walk', player.animation);

player.isMoving = false;
player.updateAnimation();
check('standing still plays the idle animation', player.animation === 'idle', player.animation);

// Every weapon that takes no ammunition must be usable however it was acquired.
{
    const melee = Object.entries(WEAPON_STATS)
        .filter(([, s]) => s.ammo === Infinity)
        .map(([name]) => name);
    const armed = new Player(100, 100);
    const empty = melee.filter((name) =>
        armed.weapons.find((w) => w.name === name)?.ammo !== Infinity);
    check('no melee weapon starts empty', empty.length === 0, empty.join(', '));
}

// The attack is driven by the trigger rather than played once. Clamping it like
// a one-shot pinned the character mid-recoil for the rest of a burst.
{
    const firing = new Player(100, 100);
    firing.currentWeaponIndex = firing.weapons.findIndex((w) => w.name === 'Rifle');

    const late = new Set();
    for (let t = 0; t < 150; t++) {
        if (t % WEAPON_STATS.Rifle.fireRate === 0) firing.playAttackAnimation();
        firing.updateAnimation();
        if (t >= 60) late.add(Math.floor(firing.animFrame));
    }
    check('the firing animation keeps cycling while the trigger is held',
        late.size > 1, `frames seen late in the burst: ${[...late].join(',')}`);
}

// A single use of a weapon has to show its whole swing. The hold used to be a
// flat 12 updates against animations running 17 to 40, so the bat -- the longest
// at twelve frames -- played only its wind-up and never the swing itself.
{
    const truncated = [];
    for (const [name, stats] of Object.entries(WEAPON_STATS)) {
        const p = new Player(100, 100);
        p.currentWeaponIndex = p.weapons.findIndex((w) => w.name === name);
        const meta = sprites.getPlayerSpriteMeta(p.spriteSlug);
        const range = sprites.resolvePlayerAnimation(meta, 'attack', stats.spriteWeapon);

        p.playAttackAnimation();
        const seen = new Set();
        for (let t = 0; t < 300; t++) {
            p.updateAnimation();
            if (p.animation === 'attack') seen.add(Math.floor(p.animFrame));
        }
        if (seen.size < range.count) {
            truncated.push(`${name}: ${seen.size}/${range.count} frames`);
        }
    }
    check('one attack plays every frame of its swing', truncated.length === 0,
        truncated.join(', '));
}

// The player is built once per game, so losing the manifest race used to mean a
// blue circle for the entire run.
{
    sprites._resetPlayerSpritesForTest();
    const early = new Player(100, 100);
    const before = early.spriteSlug;
    await sprites.loadPlayerSpriteManifest('sprites/player/manifest.json');
    check('the player picks up artwork that arrived late',
        before === null && early.getSpriteMeta() !== null,
        `${before} -> ${early.spriteSlug}`);
}

// ---------------------------------------------------------------- Degradation

sprites._resetPlayerSpritesForTest();
icons._resetItemIconsForTest();

const bare = new Player(100, 100);
check('no manifest means no character assigned', bare.spriteSlug === null);
check('drawing without artwork falls through to a shape',
    bare.drawSprite(new Proxy({}, { get: () => noop, set: () => true })) === false);
check('an unbaked icon reports that it cannot draw',
    icons.drawItemIcon(new Proxy({}, { get: () => noop, set: () => true }),
                       'pistol', 0, 0, 32) === false);

// ---------------------------------------------------------------- Result

console.log('');
if (failures === 0) {
    console.log('All player sprite checks passed.');
} else {
    console.log(`${failures} player sprite check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
