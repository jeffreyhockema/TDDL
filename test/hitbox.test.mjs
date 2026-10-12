// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Hit detection checks. Run with: npm test
 *
 * The complaint that motivated this: shots visibly passing through a monster
 * and not counting. Two causes, both covered here --
 *
 *   1. The hit region was the small movement circle at a monster's feet, while
 *      the artwork stands mostly above it. A monster's hit shape must cover
 *      the drawn body.
 *   2. Collision was a point-in-circle test on the bullet's position each
 *      frame, so a fast bullet could be on one side of a target one frame and
 *      the other side the next. Collision must test the segment travelled.
 *
 * The first half exercises js/hitbox.js in isolation; the second drives real
 * bullets, monsters and the collision pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
function makeCtx() {
    return new Proxy({}, {
        get(_t, prop) {
            if (prop === 'canvas') return { width: 1200, height: 800 };
            if (prop === 'measureText') return () => ({ width: 10 });
            if (prop === 'createRadialGradient') return () => ({ addColorStop: noop });
            if (prop === 'createLinearGradient') return () => ({ addColorStop: noop });
            if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
            return noop;
        },
        set() { return true; },
    });
}
function makeElement(id) {
    return {
        id, style: {}, dataset: {}, textContent: '', innerHTML: '',
        width: 1200, height: 800, complete: true, naturalHeight: 64,
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        addEventListener: noop, removeEventListener: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
        getContext: () => makeCtx(),
        querySelector: () => makeElement('child'),
        querySelectorAll: () => [],
        appendChild: noop,
    };
}
const elements = new Map();
const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
};
globalThis.window = globalThis;
globalThis.document = {
    getElementById: getEl, querySelector: (s) => makeElement(s), querySelectorAll: () => [],
    createElement: () => makeElement('created'), addEventListener: noop, removeEventListener: noop, hidden: false,
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.performance = globalThis.performance || { now: () => 0 };
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.AbortController = globalThis.AbortController || class { constructor() { this.signal = {}; } abort() {} };
globalThis.Image = class { constructor() { this.complete = true; this.naturalHeight = 64; } addEventListener() {} };
globalThis.fetch = async (url) => {
    const file = path.join(root, String(url));
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

const origLog = console.log;
const origWarn = console.warn;
console.log = noop;
console.warn = noop;

const hitbox = await import('../js/hitbox.js');
const { GameState } = await import('../js/game-state.js');
const { Enemy, Player } = await import('../js/entities.js');
const { Bullet, bulletHitsTarget, bulletHitFraction } = await import('../js/weapons.js');
const sprites = await import('../js/enemy-sprites.js');
const playerSprites = await import('../js/player-sprites.js');
const { TILE_SIZE, MAP_COLS, MAP_ROWS } = await import('../js/constants.js');
const { getParticles, resetParticles } = await import('../js/particles.js');

await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');
await playerSprites.loadPlayerSpriteManifest?.('sprites/player/manifest.json');

console.log = origLog;
console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const { boxShape, circleShape, segmentHitsShape, segmentHitFraction, rayShapeDistance, distanceToShape, hitShapeOf } = hitbox;

console.log('\n=== hit detection ===\n');

// =============================================================================
// 1. GEOMETRY
// =============================================================================

console.log('[shapes]');
{
    const box = boxShape(-10, -20, 10, 0);
    check('a segment through a box hits it', segmentHitsShape(box, -50, -10, 50, -10));
    check('a segment past a box misses it', !segmentHitsShape(box, -50, 5, 50, 5));
    check('a fast segment that crosses the whole box in one step still hits',
        segmentHitsShape(box, -100, -10, 100, -10));
    check('a segment that stops short misses', !segmentHitsShape(box, -50, -10, -20, -10));
    check('a segment that starts inside hits', segmentHitsShape(box, 0, -10, 50, -10));
    check('the bullet radius widens the test', !segmentHitsShape(box, -50, 3, 50, 3) && segmentHitsShape(box, -50, 3, 50, 3, 4));
    check('a stationary bullet is a point test', segmentHitsShape(box, 0, -5, 0, -5) && !segmentHitsShape(box, 0, 5, 0, 5));
    check('a diagonal graze across a corner hits', segmentHitsShape(box, -30, -30, 30, 30));

    const circle = circleShape(0, 0, 10);
    check('a segment through a circle hits it', segmentHitsShape(circle, -50, 0, 50, 0));
    check('a tangent-and-a-bit misses a circle', !segmentHitsShape(circle, -50, 10.5, 50, 10.5));
    check('a fast segment through a circle hits it', segmentHitsShape(circle, -500, 0, 500, 0));
    check('a segment behind a circle misses it', !segmentHitsShape(circle, 20, 0, 50, 0));

    const at = segmentHitFraction(box, -50, -10, 50, -10);
    check('the hit fraction is where the box edge is', Math.abs(at - 0.4) < 1e-9, at.toFixed(3));
    check('a miss has no fraction', segmentHitFraction(box, -50, 5, 50, 5) === Infinity);

    check('ray distance to a box', Math.abs(rayShapeDistance(box, -50, -10, 1, 0) - 40) < 1e-9);
    check('ray distance to a circle', Math.abs(rayShapeDistance(circle, -50, 0, 1, 0) - 40) < 1e-9);
    check('a ray pointing away misses', rayShapeDistance(circle, 50, 0, 1, 0) === Infinity);
    check('a ray from inside a shape hits at zero',
        rayShapeDistance(box, 0, -10, 1, 0) === 0 && rayShapeDistance(circle, 0, 0, 1, 0) === 0);

    check('distance to a box is to its nearest edge', Math.abs(distanceToShape(box, 30, -10) - 20) < 1e-9 &&
        distanceToShape(box, 0, -10) === 0);
    check('distance to a circle is to its rim', Math.abs(distanceToShape(circle, 30, 0) - 20) < 1e-9);
}

// =============================================================================
// 2. ENTITIES
// =============================================================================

const gs = new GameState();
gs.selectedDifficulty = 'medium';
gs.currentLevel = 1;

function openMap() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
    for (let r = 2; r < MAP_ROWS - 2; r++) for (let c = 2; c < MAP_COLS - 2; c++) map[r][c] = 0;
    return map;
}

function world() {
    gs.gameMap = openMap();
    gs.enemies = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.temporaryVisualEffects = [];
    gs.currentBoss = null;
    gs.player = new Player(800, 800);
    gs.player.health = gs.player.maxHealth = 100000;
    resetParticles(gs.gameMap);
    return gs.player;
}

console.log('[monster hit shapes]');
{
    world();
    const imp = new Enemy(500, 500, 'imp');
    gs.enemies.push(imp);
    const shape = imp.getHitShape();
    check('a monster has a box the size of its drawn body', shape && shape.kind === 'box');
    check('the box stands on the feet and rises above the centre',
        shape.bottom > imp.y && shape.top < imp.y - imp.radius, `${shape.top.toFixed(0)}..${shape.bottom.toFixed(0)} around ${imp.y}`);
    check('the box is at least as wide as the movement circle', shape.right - shape.left >= imp.radius * 2);
    check('the box is taller than the movement circle', shape.bottom - shape.top > imp.radius * 2);

    // A round through the chest, well above the movement circle.
    const chestY = imp.y - imp.radius * 1.6;
    const chest = new Bullet(imp.x - 20, chestY, 0, 12, 'player', 10);
    chest.prevX = chest.x; chest.prevY = chest.y;
    chest.update();
    check('a bullet through the chest is a hit', bulletHitsTarget(chest, imp));

    const feet = new Bullet(imp.x - 20, imp.y + imp.radius * 0.9, 0, 12, 'player', 10);
    feet.update();
    check('a bullet through the feet is a hit', bulletHitsTarget(feet, imp));

    const over = new Bullet(imp.x - 20, shape.top - 8, 0, 12, 'player', 10);
    over.update();
    check('a bullet over the head is a miss', !bulletHitsTarget(over, imp));

    const cyber = new Enemy(700, 700, 'cyberdemon');
    const big = cyber.getHitShape();
    check('a bigger sprite has a bigger box',
        (big.bottom - big.top) > (shape.bottom - shape.top) * 2 && (big.right - big.left) > (shape.right - shape.left) * 1.5);
}

console.log('[player hit shape]');
{
    const player = world();
    const shape = player.getHitShape();
    // The marine's shoulders span his 16-unit radius, as Doom's sprite spans
    // his, so the body circle and the movement circle are the same circle.
    check('the player has a circle the width of the artwork', shape && shape.kind === 'circle' &&
        Math.abs(shape.r - player.radius) < 1e-9,
        shape ? `${shape.r.toFixed(1)} vs ${player.radius.toFixed(1)}` : 'no shape');

    // A fireball clipping the shoulder: 3px inside the circle's edge.
    const graze = new Bullet(player.x - 30, player.y - player.radius + 3, 0, 30, 'enemy', 10);
    graze.update();
    check('a fireball clipping the shoulder hits', bulletHitsTarget(graze, player),
        `body ${shape.r.toFixed(1)}, movement ${player.radius.toFixed(1)}`);
    // ...and one passing 5px outside sails on, as it would past Doom's marine
    const miss = new Bullet(player.x - 30, player.y - player.radius - 5 - 4, 0, 30, 'enemy', 10);
    miss.update();
    check('a fireball passing outside the shoulder misses', !bulletHitsTarget(miss, player));
}

console.log('[fast bullets]');
{
    world();
    const zombie = new Enemy(500, 500, 'zombieman');
    gs.enemies.push(zombie);
    const width = zombie.getHitShape().right - zombie.getHitShape().left;

    // A bullet moving faster than the target is wide, starting just short of
    // it: after one frame it is past the far side. The old point test missed.
    const fast = new Bullet(zombie.x - width, zombie.y - 5, 0, width * 2.5, 'player', 10);
    fast.update();
    check('a bullet faster than the target is wide still hits', bulletHitsTarget(fast, zombie),
        `speed ${(width * 2.5).toFixed(0)} vs width ${width.toFixed(0)}`);
    check('...and the hit is where it entered the body',
        bulletHitFraction(fast, zombie) > 0 && bulletHitFraction(fast, zombie) < 0.5);
}

console.log('[collision pass]');
{
    world();
    const near = new Enemy(500, 500, 'imp');
    const far = new Enemy(560, 500, 'imp');
    gs.enemies.push(far, near);   // far first in the array, on purpose
    const hpNear = near.health;
    const hpFar = far.health;

    // One frame of travel crosses both. Only the nearer may be hit.
    const bullet = new Bullet(430, 490, 0, 200, 'player', 10);
    bullet.update();
    gs.bullets.push(bullet);
    gs.resolveBulletCollisions();
    check('a bullet crossing two monsters hits the nearer one, not the first in the list',
        near.health < hpNear && far.health === hpFar);
    check('a spent bullet is removed by the collision pass', gs.bullets.length === 0);
}
{
    world();
    // A monster standing against a wall: the bullet dies on the wall in the
    // same frame it crosses the monster. It must still count.
    for (let r = 0; r < MAP_ROWS; r++) gs.gameMap[r][14] = 1;
    const imp = new Enemy(14 * TILE_SIZE - 14, 500, 'imp');
    gs.enemies.push(imp);
    const hp = imp.health;
    const bullet = new Bullet(imp.x - 40, imp.y - 10, 0, 60, 'player', 10);
    gs.bullets.push(bullet);
    gs.updateBullets();
    check('the bullet died on the wall', bullet.life === 0);
    gs.resolveBulletCollisions();
    check('a bullet that hits a wall behind a monster still hits the monster', imp.health < hp);
}
{
    world();
    // A rocket that detonated on a wall must not detonate again on a monster.
    for (let r = 0; r < MAP_ROWS; r++) gs.gameMap[r][14] = 1;
    const imp = new Enemy(14 * TILE_SIZE - 14, 500, 'imp');
    gs.enemies.push(imp);
    const rocket = new Bullet(imp.x - 40, imp.y - 10, 0, 60, 'player', 50, '#f00', true, 100, 30);
    gs.bullets.push(rocket);
    gs.updateBullets();
    gs.resolveBulletCollisions();
    check('a rocket detonates once', gs.explosions.length === 1, `${gs.explosions.length}`);
}

console.log('[hitscan]');
{
    const player = world();
    const zombie = new Enemy(player.x - 200, player.y, 'zombieman');
    zombie.ambush = false;
    zombie.acquireTarget(player, false);
    gs.enemies.push(zombie);
    // Aim at the player's shoulder: just inside the edge of the body circle.
    const angle = Math.atan2(-player.radius + 3, 200);
    const hit = zombie.traceHitscan(angle);
    check('a hitscan shot clipping the shoulder hits the player', hit.thing === player);

    const blocker = new Enemy(player.x - 100, player.y, 'imp');
    gs.enemies.push(blocker);
    const through = zombie.traceHitscan(0);
    check('a hitscan shot stops on the first body in the way', through.thing === blocker);
}

console.log('[melee reach]');
{
    const player = world();
    // Doom's MELEERANGE (64 units, 40px) is measured to the edge of the body
    const baron = new Enemy(player.x + 50, player.y, 'baron');
    gs.enemies.push(baron);
    player.angle = 0;
    const knife = player.weapons.find(w => w.name === 'Knife');
    const hp = baron.health;
    player.performMeleeAttack(knife);
    check('a swing reaching the body connects even when the centre is out of reach',
        baron.health < hp, `reach ${knife.meleeRange}, centre at 50`);
}

console.log('[blood]');
{
    world();
    const imp = new Enemy(500, 500, 'imp');
    gs.enemies.push(imp);
    const before = getParticles().length;
    // Several rounds, so the direction check is a sample and not a coin toss
    for (let i = 0; i < 6; i++) {
        const bullet = new Bullet(480, 490, 0, 12, 'player', 1);
        bullet.update();
        gs.bullets.push(bullet);
        gs.resolveBulletCollisions();
    }
    check('a hit sprays blood', getParticles().length > before);
    check('the spray leaves along the shot', getParticles().filter(p => p.kind === 'blood' && p.vx > 0).length >
        getParticles().filter(p => p.kind === 'blood' && p.vx < 0).length);
}

// ---------------------------------------------------------------- Result

console.log('');
if (failures === 0) {
    console.log('All hit detection checks passed.');
} else {
    console.log(`${failures} hit detection check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
