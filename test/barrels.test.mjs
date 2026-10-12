// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Exploding barrel checks. Run with: npm test
 *
 * A barrel is a body that stands in the way, takes a hit, and goes off;
 * the checks drive the real player, monsters, bullets and explosions at one.
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

const { GameState } = await import('../js/game-state.js');
const { Player, Enemy } = await import('../js/entities.js');
const { Bullet } = await import('../js/weapons.js');
const { Barrel, BARRELS, planBarrels } = await import('../js/barrels.js');
const { generateMaze } = await import('../js/map-generator.js');
const { keys, resetInputState } = await import('../js/input-handler.js');
const { TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL, TILE_KEY_RED } = await import('../js/constants.js');
const sprites = await import('../js/enemy-sprites.js');
await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');

console.log = origLog;
console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

console.log('\n=== barrels ===\n');

const T = TILE_SIZE;
const centre = (tile) => tile * T + T / 2;

function hall() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_WALL));
    for (let r = 2; r < MAP_ROWS - 2; r++) for (let c = 2; c < MAP_COLS - 2; c++) map[r][c] = TILE_EMPTY;
    return map;
}

// =============================================================================
// PLANNING
// =============================================================================

console.log('[planning]');
{
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_WALL));
    const start = { x: 4, y: 20, width: 6, height: 5, id: 0, role: 'start', center: { x: 7, y: 22 } };
    const bay = { x: 18, y: 14, width: 12, height: 10, id: 1, role: 'transit', center: { x: 24, y: 19 } };
    for (const r of [start, bay]) for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) map[y][x] = TILE_EMPTY;
    for (let x = 10; x < 18; x++) { map[21][x] = TILE_EMPTY; map[22][x] = TILE_EMPTY; }
    map[16][20] = TILE_KEY_RED;
    const kinds = { 0: 'plain', 1: 'cargo' };

    check('level 1 has no barrels', planBarrels(map, [start, bay], kinds, start, { level: 1 }).length === 0);

    const spots = planBarrels(map, [start, bay], kinds, start, { level: 4 });
    check('a cargo bay gets a group', spots.length >= BARRELS.GROUP_MIN && spots.length <= BARRELS.GROUP_MAX, `${spots.length}`);
    const tiles = spots.map(s => [Math.floor(s.x / T), Math.floor(s.y / T)]);
    check('they stand on floor inside the bay', tiles.every(([c, r]) => map[r][c] === TILE_EMPTY && c >= bay.x && c < bay.x + bay.width && r >= bay.y && r < bay.y + bay.height));
    check('against a wall', tiles.every(([c, r]) => c === bay.x || c === bay.x + bay.width - 1 || r === bay.y || r === bay.y + bay.height - 1));
    // The corridor enters at rows 21-22: no barrel on the west wall beside it
    check('clear of the doorway', tiles.every(([c, r]) => !(c === bay.x && r >= 20 && r <= 23)));
    check('clear of the key', tiles.every(([c, r]) => Math.abs(c - 20) > 2 || Math.abs(r - 16) > 2));
    check('in one cluster', tiles.every(([c, r]) => tiles.some(([oc, or]) => (oc !== c || or !== r) && Math.abs(oc - c) <= 1 && Math.abs(or - r) <= 1)));
    check('never in the start room', tiles.every(([c]) => c >= bay.x));
}
{
    globalThis.gameState = { currentLevel: 5, selectedDifficulty: 'medium', player: null };
    let levels = 0, withBarrels = 0, most = 0;
    for (let i = 0; i < 4; i++) {
        console.log = noop;
        const data = generateMaze(MAP_COLS, MAP_ROWS, false);
        console.log = origLog;
        if (!data.barrels) continue;
        levels++;
        if (data.barrels.length > 0) withBarrels++;
        most = Math.max(most, data.barrels.length);
    }
    check('generated levels carry barrels', levels > 0 && withBarrels === levels, `${withBarrels} of ${levels}`);
    check('...sparingly', most <= BARRELS.MAX_GROUPS * BARRELS.GROUP_MAX, `${most}`);
    delete globalThis.gameState;
}

// =============================================================================
// RUNTIME
// =============================================================================

const gs = new GameState();
gs.selectedDifficulty = 'medium';
gs.currentLevel = 3;

function world() {
    gs.gameMap = hall();
    gs.enemies = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.barrels = [];
    gs.temporaryVisualEffects = [];
    gs.currentBoss = null;
    gs.noiseTiles = null;
    gs.noiseFrame = -1;
    gs.player = new Player(centre(20), centre(20));
    gs.player.health = gs.player.maxHealth = 100000;
    resetInputState();
    return gs.player;
}

function frames(n) {
    for (let i = 0; i < n; i++) {
        gs.frameCount++;
        gs.update();
        gs.player.health = gs.player.maxHealth = Math.max(gs.player.health, 1000);
    }
}

console.log('[a body in the way]');
{
    const player = world();
    const barrel = new Barrel(centre(22), centre(20));
    gs.barrels.push(barrel);
    keys.d = true;
    frames(60);
    keys.d = false;
    check('a barrel stops the player', player.x < barrel.x - barrel.radius, `${player.x.toFixed(0)} vs ${barrel.x}`);
    check('the barrel is unharmed by being walked into', barrel.health === barrel.maxHealth);

    const imp = new Enemy(centre(30), centre(20), 'imp');
    check('a barrel stops a monster', !imp.canStandAt(barrel.x + 4, barrel.y));
}

console.log('[what sets one off]');
{
    world();
    const barrel = new Barrel(centre(24), centre(20));
    gs.barrels.push(barrel);
    const bullet = new Bullet(barrel.x - 30, barrel.y - 4, 0, 20, 'player', 10);
    bullet.update();
    gs.bullets.push(bullet);
    gs.resolveBulletCollisions();
    check('a bullet hits a barrel', barrel.health < barrel.maxHealth && gs.bullets.length === 0);

    barrel.takeDamage(1000);
    check('enough damage lights the fuse', barrel.exploding && !barrel.isDead && gs.explosions.length === 0);
    frames(BARRELS.FUSE_FRAMES + 1);
    check('...and it goes off', gs.explosions.length === 1 && !gs.barrels.includes(barrel));
    check('...loudly', gs.noiseTiles !== null && gs.noiseTiles.size > 0);
}
{
    const player = world();
    const zombie = new Enemy(centre(25), centre(20), 'zombieman');
    zombie.ambush = false;
    zombie.acquireTarget(player, false);
    gs.enemies.push(zombie);
    const barrel = new Barrel(centre(27), centre(20));
    gs.barrels.push(barrel);
    zombie.face(0);
    // Shooting right past... a hitscan straight along the row hits the barrel first
    const hit = zombie.traceHitscan(0);
    check('a hitscan shot stops on a barrel', hit.thing === barrel);

    player.x = centre(26);
    player.angle = 0;
    const knife = player.weapons.find(w => w.name === 'Knife');
    const hp = barrel.health;
    player.performMeleeAttack(knife);
    check('a knife can hit one', barrel.health < hp);
}

console.log('[the blast]');
{
    const player = world();
    const barrel = new Barrel(centre(24), centre(20));
    const next = new Barrel(centre(25), centre(20));
    const far = new Barrel(centre(34), centre(20));
    gs.barrels.push(barrel, next, far);
    const imp = new Enemy(centre(23), centre(21), 'imp');
    gs.enemies.push(imp);
    player.x = centre(25);
    player.y = centre(21);
    const hp = player.health;
    const impHp = imp.health;

    barrel.takeDamage(1000);
    frames(BARRELS.FUSE_FRAMES + 12);          // The fuse, then the blast's own delay to full radius
    check('the blast hurts a monster beside it', imp.health < impHp, `${impHp} -> ${imp.health}`);
    check('...and the player', player.health < hp);
    check('...and lights the next barrel', next.exploding || next.isDead);
    frames(BARRELS.FUSE_FRAMES + 12);
    check('which goes off in its turn', !gs.barrels.includes(next) && gs.explosions.length >= 1);
    check('a barrel out of reach is untouched', gs.barrels.includes(far) && !far.exploding && far.health === far.maxHealth);
}

console.log('');
if (failures === 0) {
    console.log('All barrel checks passed.');
} else {
    console.log(`${failures} barrel check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
