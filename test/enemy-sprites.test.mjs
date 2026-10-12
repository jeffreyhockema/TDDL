// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Enemy sprite system checks. Run with: npm test
 *
 * Covers the two halves of the enemy artwork:
 *
 *   1. The baked assets -- every atlas named by sprites/enemies/manifest.json
 *      is in the enemy packs, and every animation slot the game asks for
 *      resolves to frames that actually sit inside its atlas. A build that
 *      silently dropped an animation, or a manifest that outran a rebuild,
 *      fails here rather than as a blank enemy in a dark corridor. The atlases
 *      are read out of sprites/enemies.pak and sprites/enemies-extra.pak, as
 *      the game reads them: the loose PNGs are not in the repository.
 *
 *   2. The animation state machine on Enemy -- that attacks aren't cut short,
 *      that being hit interrupts, that death plays through before the body is
 *      removed, and that a missing manifest degrades to the old behaviour
 *      instead of leaving corpses in the level forever.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_FILES, packedFile, pngSize, diskFetch } from './pack-files.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const spriteDir = path.join(root, 'sprites', 'enemies');

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
// entities.js reaches for document/Image at module scope and during draw; the
// sprite loader creates Image elements. None of it needs to do anything real.
function makeElement() {
    return {
        style: {}, dataset: {}, complete: true, naturalHeight: 64,
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        addEventListener: noop, removeEventListener: noop,
        getContext: () => new Proxy({}, { get: () => noop, set: () => true }),
    };
}

globalThis.window = globalThis;
globalThis.document = {
    getElementById: makeElement,
    querySelector: makeElement,
    querySelectorAll: () => [],
    createElement: makeElement,
    addEventListener: noop,
    removeEventListener: noop,
};
globalThis.Image = class {
    constructor() {
        this.complete = true;
        this.naturalHeight = 64;
    }
    addEventListener() {}
};

// The manifest and packs are fetched over HTTP in the browser. Serve them off
// disk here so the suite exercises the real, generated data rather than a
// fixture that can drift away from what the build produces.
globalThis.fetch = diskFetch();

const origLog = console.log;
const origWarn = console.warn;
console.log = noop;
console.warn = noop;

const sprites = await import('../js/enemy-sprites.js');
const { Enemy } = await import('../js/entities.js');

console.log = origLog;
console.warn = origWarn;

console.log('\n=== enemy sprites ===\n');

// ---------------------------------------------------------------- Assets

const manifest = JSON.parse(fs.readFileSync(path.join(spriteDir, 'manifest.json'), 'utf8'));
const slugs = Object.keys(manifest.characters);

check('the manifest lists characters', slugs.length > 0, `${slugs.length} found`);

const loaded = await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');
check('the loader accepts the generated manifest', loaded);
check('the loader sees every character',
    sprites.getEnemySpriteSlugs().length === slugs.length);

// Every animation the game can request, against every direction it can face.
const REQUESTED = ['idle', 'idle_blink', 'walk', 'run', 'attack', 'hurt', 'dying'];
const DIRECTIONS = ['down', 'up', 'left', 'right'];

const missingAtlases = [];
const unresolved = [];
const outOfBounds = [];

for (const slug of slugs) {
    const meta = manifest.characters[slug];
    const atlas = packedFile([PACK_FILES.enemies, PACK_FILES.enemiesExtra], meta.file);

    if (!atlas) {
        missingAtlases.push(slug);
        continue;
    }

    const { width, height } = pngSize(atlas);

    for (const animation of REQUESTED) {
        for (const direction of DIRECTIONS) {
            const range = sprites.resolveEnemyAnimation(meta, animation, direction);
            if (!range) {
                unresolved.push(`${slug}/${animation}/${direction}`);
                continue;
            }

            // Check the last frame: if the tail of an animation fits, so does
            // everything before it.
            const rect = sprites.getEnemyFrameRect(meta, range, range.count - 1);
            if (rect.x + rect.width > width || rect.y + rect.height > height) {
                outOfBounds.push(`${slug}/${animation}/${direction}`);
            }
        }
    }
}

check('every atlas named by the manifest is in the enemy packs', missingAtlases.length === 0,
    missingAtlases.join(', '));
check('every animation resolves in every direction', unresolved.length === 0,
    unresolved.slice(0, 5).join(', '));
check('every frame lies inside its atlas', outOfBounds.length === 0,
    outOfBounds.slice(0, 5).join(', '));

// The renderer divides by bodyHeight and offsets by the anchor, so neither may
// be missing or zero.
const badGeometry = slugs.filter((slug) => {
    const c = manifest.characters[slug];
    return !(c.bodyHeight > 0) || !(c.frameWidth > 0) || !(c.frameHeight > 0) ||
           !(c.columns > 0) || !Number.isFinite(c.anchorX) || !Number.isFinite(c.anchorY);
});
check('every character has usable draw geometry', badGeometry.length === 0,
    badGeometry.join(', '));

// The death animation is the one the corpse phase waits on; without it a body
// would linger until its (absent) animation finished.
const noDeath = slugs.filter((slug) =>
    !sprites.resolveEnemyAnimation(manifest.characters[slug], 'dying', 'down'));
check('every character has a death animation', noDeath.length === 0, noDeath.join(', '));

check('a random pick returns a known character',
    slugs.includes(sprites.pickRandomEnemySprite()));

// ---------------------------------------------------------------- Animation

globalThis.gameState = { selectedDifficulty: 'medium', currentLevel: 1, player: null };

/** Runs an enemy's animation clock without its AI, which needs a live map. */
function tickAnimation(enemy, ticks) {
    for (let i = 0; i < ticks; i++) enemy.updateAnimation();
}

const enemy = new Enemy(100, 100, 'imp');
check('a spawned enemy is assigned a character', slugs.includes(enemy.spriteSlug));

// A Doom monster never strolls -- it stands, then comes flat out -- so whether
// that looks like a walk or a run is a matter of how fast it actually is.
enemy.isMoving = true;
const impSpeed = enemy.speed;
enemy.speed = 0.7;
check('a slow monster walks', enemy.selectIdleOrMoveAnimation() === 'walk');

enemy.speed = 1.8;
check('a fast monster runs', enemy.selectIdleOrMoveAnimation() === 'run');
enemy.speed = impSpeed;

// An attack must own the enemy until it finishes, or a swing would be cut off
// the moment the enemy started moving again.
enemy.playAnimation('attack', true);
check('attacking locks the animation', enemy.animLocked && enemy.animation === 'attack');

enemy.playAnimation('run');
check('movement does not interrupt an attack', enemy.animation === 'attack');

tickAnimation(enemy, 120);
check('the attack releases the lock once it ends', !enemy.animLocked);
check('the enemy returns to a looping animation',
    ['idle', 'idle_blink', 'walk', 'run'].includes(enemy.animation));

// A hit that passes the pain roll interrupts whatever the monster was doing.
// The roll is forced to succeed here; its odds are the monster's own business.
enemy.playAnimation('attack', true);
{
    const realRandom = Math.random;
    Math.random = () => 0;
    enemy.takeDamage(1);
    Math.random = realRandom;
}
check('a painful hit interrupts an attack', enemy.animation === 'hurt');

// ---------------------------------------------------------------- Death

const dying = new Enemy(100, 100, 'imp');
dying.takeDamage(100000);

check('a killed enemy is marked dead', dying.isDead);
check('a killed enemy plays its death animation', dying.animation === 'dying');
check('a fresh corpse is not removed immediately', !dying.isReadyToRemove());

// A corpse must be inert: no further hits, no attacks, no movement.
check('a corpse rejects further damage', dying.takeDamage(50) === false);

dying.isMoving = true;
dying.update();
check('a corpse does not move', dying.isMoving === false);

const deathRange = sprites.resolveEnemyAnimation(
    sprites.getEnemySpriteMeta(dying.spriteSlug), 'dying', dying.facingDirection);
const deathTicks = Math.ceil(deathRange.count * 60 / manifest.frameRates.dying);

for (let i = 0; i < deathTicks + 120; i++) dying.update();
check('the body is removed once the death animation has played',
    dying.isReadyToRemove());

// The damage flash is a canvas filter applied while hitTimer runs. update()
// used to return early for a corpse before decaying it, so the killing blow's
// flash never expired and every death played as a white blowout.
{
    const flashing = new Enemy(100, 100, 'imp');
    flashing.takeDamage(100000);
    const atDeath = flashing.hitTimer;
    for (let i = 0; i < 40; i++) flashing.update();
    check('the damage flash decays on a corpse',
        atDeath > 0 && flashing.hitTimer === 0, `${atDeath} -> ${flashing.hitTimer}`);
}

// The linger is meant to hold the final pose *after* the body has fallen. It
// used to count down from the moment of death, alongside a death animation of
// the same length, so it added no hold at all.
{
    const lingering = new Enemy(100, 100, 'imp');
    lingering.takeDamage(100000);

    let fellAt = -1;
    let removableAt = -1;
    for (let t = 1; t <= 400 && removableAt < 0; t++) {
        lingering.update();
        if (fellAt < 0 && lingering.isDeathAnimationFinished()) fellAt = t;
        if (lingering.isReadyToRemove()) removableAt = t;
    }
    check('the corpse holds its final pose after falling',
        fellAt > 0 && removableAt > fellAt, `fell at ${fellAt}, removed at ${removableAt}`);
}

// A flinch restarted on every hit pinned enemies on frame 0 for as long as they
// were under automatic fire, which read as frozen.
{
    const shot = new Enemy(100, 100, 'imp');
    shot.health = 1e9;
    shot.maxHealth = 1e9;

    const frames = new Set();
    for (let t = 0; t < 90; t++) {
        if (t % 4 === 0) shot.takeDamage(1);   // roughly the rifle's cadence
        shot.updateAnimation();
        if (shot.animation === 'hurt') frames.add(Math.floor(shot.animFrame));
    }
    check('the flinch keeps animating under sustained fire', frames.size > 1,
        `frames seen: ${[...frames].join(',')}`);
}

// An enemy that spawned before the manifest landed used to stay on shapes for
// its whole life.
{
    sprites._resetEnemySpritesForTest();
    const early = new Enemy(100, 100, 'imp');
    const before = early.spriteSlug;
    await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');
    check('an enemy picks up artwork that arrived late',
        before === null && slugs.includes(early.getSpriteMeta() ? early.spriteSlug : ''),
        `${before} -> ${early.spriteSlug}`);
}

// ---------------------------------------------------------------- Degradation

// With no artwork loaded the enemy must behave exactly as it did before sprites
// existed: shape rendering, and removed the moment it dies. A corpse that waits
// on an animation that will never play would never leave the level.
sprites._resetEnemySpritesForTest();

const bare = new Enemy(100, 100, 'imp');
check('no manifest means no character assigned', bare.spriteSlug === null);
check('drawing without artwork falls through to shapes',
    bare.drawSprite(new Proxy({}, { get: () => noop, set: () => true })) === false);

bare.takeDamage(100000);
check('an enemy with no artwork is removed at once', bare.isReadyToRemove());

// ---------------------------------------------------------------- Result

console.log('');
if (failures === 0) {
    console.log('All enemy sprite checks passed.');
} else {
    console.log(`${failures} enemy sprite check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
