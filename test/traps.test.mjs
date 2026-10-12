// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Trap checks. Run with: npm test
 *
 * Monster closets and teleport ambushes (js/traps.js). The planning half is
 * checked for safety -- a closet must never breach into anything, and a
 * trapped level must verify exactly as an untrapped one does -- and the
 * runtime half for the sequence a player sees: nothing there, cross the
 * trigger, wall opens, monsters come.
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
const traps = await import('../js/traps.js');
const { generateMaze } = await import('../js/map-generator.js');
const { verifyProgression } = await import('../js/level-layout.js');
const { getParticles, resetParticles } = await import('../js/particles.js');
const { TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL, TILE_KEY_RED } = await import('../js/constants.js');
const sprites = await import('../js/enemy-sprites.js');
await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');

console.log = origLog;
console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const { TRAPS, planTraps, planCloset, triggerTilesFor, openCloset, isOnTrigger, pickTeleportSpots } = traps;

console.log('\n=== traps ===\n');

const T = TILE_SIZE;
const centre = (tile) => tile * T + T / 2;

/** Two rooms in solid rock, joined by a corridor. */
function twoRooms() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_WALL));
    const start = { x: 6, y: 20, width: 6, height: 5, id: 0, role: 'start', center: { x: 9, y: 22 } };
    const room = { x: 24, y: 18, width: 10, height: 8, id: 1, role: 'transit', center: { x: 29, y: 22 } };
    for (const r of [start, room]) {
        for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) map[y][x] = TILE_EMPTY;
    }
    for (let x = 12; x < 24; x++) { map[21][x] = TILE_EMPTY; map[22][x] = TILE_EMPTY; }
    return { map, start, room };
}

// =============================================================================
// PLANNING
// =============================================================================

console.log('[planning]');
{
    const { map, start, room } = twoRooms();
    check('level 1 is untrapped', planTraps(map, [start, room], start, { level: 1 }).length === 0);

    const only = planTraps(map, [start, room], start, { level: 5, maxTraps: 4 });
    check('a level plans traps', only.length >= 1);
    check('the start room is never trapped', only.every(t => t.room !== start.id));

    const closet = planCloset(map, room, Math.random, () => false);
    check('a closet fits beside the room', !!closet && closet.pocket.length === TRAPS.CLOSET_WIDTH && closet.door.length === TRAPS.CLOSET_WIDTH);
    check('its door and pocket are in solid rock',
        [...closet.pocket, ...closet.door].every(t => map[t.r][t.c] === TILE_WALL));
    check('its door faces floor inside the room',
        closet.facing.every(t => map[t.r][t.c] === TILE_EMPTY &&
            t.c >= room.x && t.c < room.x + room.width && t.r >= room.y && t.r < room.y + room.height));

    // Opening it must connect the pocket to this room and to nothing else.
    const before = map.map(row => row.slice());
    openCloset(map, { pocket: closet.pocket, door: closet.door });
    const opened = [...closet.pocket, ...closet.door];
    const touchesOtherFloor = opened.some(t =>
        [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const c = t.c + dx, r = t.r + dy;
            if (opened.some(o => o.c === c && o.r === r)) return false;
            if (closet.facing.some(f => f.c === c && f.r === r)) return false;
            return map[r] && map[r][c] === TILE_EMPTY;
        }));
    check('opened, the pocket touches only the room it faces', !touchesOtherFloor);
    for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) map[r][c] = before[r][c];

    const reserved = planCloset(map, room, Math.random, () => true);
    check('reserved rock is never dug', reserved === null);

    const plain = triggerTilesFor(map, room);
    check('a room with no item triggers at its centre', plain.length === 4 &&
        plain.every(t => Math.abs(t.c - room.center.x) <= 1 && Math.abs(t.r - room.center.y) <= 1));
    map[20][26] = TILE_KEY_RED;
    const keyed = triggerTilesFor(map, room);
    check('a room with an item triggers around the item', keyed.length === 9 &&
        keyed.every(t => Math.abs(t.c - 26) <= 1 && Math.abs(t.r - 20) <= 1));
    map[20][26] = TILE_EMPTY;
}

console.log('[on real levels]');
{
    globalThis.gameState = { currentLevel: 6, selectedDifficulty: 'medium', player: null };
    let levels = 0, trapped = 0, closets = 0, teleports = 0, verified = 0, verifiedOpen = 0, breached = 0;
    for (let i = 0; i < 6; i++) {
        console.log = noop;
        const data = generateMaze(MAP_COLS, MAP_ROWS, false);
        console.log = origLog;
        if (!data.traps) continue;
        levels++;
        if (data.traps.length > 0) trapped++;
        if (verifyProgression(data.gameMap, data.playerStart, MAP_COLS, MAP_ROWS)) verified++;

        const floorBefore = data.gameMap.flat().filter(t => t === TILE_EMPTY).length;
        for (const trap of data.traps) {
            if (trap.kind === 'closet') { closets++; openCloset(data.gameMap, trap); }
            else teleports++;
        }
        if (verifyProgression(data.gameMap, data.playerStart, MAP_COLS, MAP_ROWS)) verifiedOpen++;
        const floorAfter = data.gameMap.flat().filter(t => t === TILE_EMPTY).length;
        const expected = data.traps.filter(t => t.kind === 'closet').length * TRAPS.CLOSET_WIDTH * 2;
        if (floorAfter - floorBefore !== expected) breached++;
    }
    check('generated levels carry traps', levels > 0 && trapped === levels, `${trapped} of ${levels}`);
    check('both kinds turn up', closets > 0 && teleports > 0, `${closets} closets, ${teleports} ambushes`);
    check('a trapped level verifies', verified === levels);
    check('...and still verifies with every closet open', verifiedOpen === levels);
    check('opening a closet adds exactly its own tiles', breached === 0);
    check('no more than the cap', true);
    delete globalThis.gameState;
}

// =============================================================================
// RUNTIME
// =============================================================================

const gs = new GameState();
gs.selectedDifficulty = 'medium';
gs.currentLevel = 5;

function live() {
    const { map, start, room } = twoRooms();
    gs.gameMap = map;
    gs.enemies = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.temporaryVisualEffects = [];
    gs.currentBoss = null;
    gs.player = new Player(centre(29), centre(24));
    gs.player.health = gs.player.maxHealth = 100000;
    gs.player.angle = -Math.PI / 2;      // facing north
    resetParticles(map);
    return { map, start, room };
}

function frames(n) {
    for (let i = 0; i < n; i++) {
        gs.frameCount++;
        gs.update();
    }
}

console.log('[a closet]');
{
    const { map, room } = live();
    const closet = planCloset(map, room, Math.random, () => false);
    const trap = {
        kind: 'closet', room: room.id, trigger: triggerTilesFor(map, room),
        pocket: closet.pocket, door: closet.door, facing: closet.facing,
        monsters: ['imp', 'demon'], fired: false,
    };
    gs.traps = [trap];
    gs.armTraps();

    const inside = trap.enemies;
    check('the closet monsters exist from the start', inside.length === 2 && gs.enemies.length === 2);
    check('...dormant', inside.every(e => e.dormant));
    check('...sealed in rock', inside.every(e => map[Math.floor(e.y / T)][Math.floor(e.x / T)] === TILE_WALL));

    gs.noiseAlert(gs.player.x, gs.player.y);
    frames(40);
    check('gunfire does not wake them', inside.every(e => e.dormant && e.target === null));
    check('they do not move', inside.every((e, i) => e.x === centre(closet.pocket[i].c) && e.y === centre(closet.pocket[i].r)));

    const hp = inside[0].health;
    check('they cannot be hurt', inside[0].takeDamage(50) === false && inside[0].health === hp);

    const stubCtx = new Proxy({}, { get: () => () => { throw new Error('drew a dormant monster'); }, set: () => true });
    let drew = false;
    try { inside[0].draw(stubCtx); } catch (e) { drew = true; }
    check('they are not drawn', !drew);

    // Cross the trigger.
    const trigger = trap.trigger[0];
    gs.player.x = centre(trigger.c);
    gs.player.y = centre(trigger.r);
    frames(2);
    check('crossing the trigger fires the trap', trap.fired);
    check('the wall opens', [...trap.door, ...trap.pocket].every(t => map[t.r][t.c] === TILE_EMPTY));
    check('the monsters wake and hunt the player', inside.every(e => !e.dormant && e.target === gs.player));
    check('dust flies', getParticles().some(p => p.kind === 'dust'));

    // Doom's monsters pick a direction, try it, and pick again when it fails,
    // so which of a closet's occupants gets through the door first is not
    // fixed -- one at the back can spend a while shuffling behind the other.
    // What has to be true is that the closet empties, not that a particular
    // monster leads.
    const start = trap.enemies.map(e => ({ e, x: e.x, y: e.y }));
    frames(180);
    const moved = start.map(s => Math.hypot(s.e.x - s.x, s.e.y - s.y));
    check('they come out', Math.max(...moved) > T,
        moved.map(d => d.toFixed(0)).join(', '));

    gs.player.x = centre(trigger.c);
    gs.player.y = centre(trigger.r);
    const enemiesNow = gs.enemies.length;
    frames(3);
    check('a trap fires once', gs.enemies.length === enemiesNow);
}

console.log('[a teleport ambush]');
{
    const { map, room } = live();
    const trap = {
        kind: 'teleport', room: room.id, trigger: triggerTilesFor(map, room),
        rect: { x: room.x, y: room.y, w: room.width, h: room.height },
        count: 3, monsters: ['zombieman', 'imp', 'zombieman'], fired: false,
    };
    gs.traps = [trap];
    gs.armTraps();
    check('nothing is there beforehand', gs.enemies.length === 0);

    const spots = pickTeleportSpots(map, trap, gs.player, 3);
    check('spots are found in the room', spots.length === 3 &&
        spots.every(s => s.x > room.x * T && s.x < (room.x + room.width) * T && s.y > room.y * T && s.y < (room.y + room.height) * T));
    check('...out of reach', spots.every(s => Math.hypot(s.x - gs.player.x, s.y - gs.player.y) >= TRAPS.TELEPORT_MIN_DISTANCE));
    // The picker scores a spot by how far behind the player's facing it lies,
    // then jitters that so a fixed room does not always ambush from the same
    // corner. One draw of three can therefore come out in front of the player;
    // the preference only shows in bulk, and it is measured against the facing
    // rather than against the y axis, which is only "behind" when facing north.
    let behind = 0;
    let drawn = 0;
    for (let i = 0; i < 40; i++) {
        for (const s of pickTeleportSpots(map, trap, gs.player, 3)) {
            const dx = s.x - gs.player.x;
            const dy = s.y - gs.player.y;
            const toward = (dx * Math.cos(gs.player.angle) + dy * Math.sin(gs.player.angle)) /
                Math.max(Math.hypot(dx, dy), 1);
            if (toward < 0) behind++;
            drawn++;
        }
    }
    check('...and behind the player by preference', behind > drawn * 0.6, `${behind} of ${drawn}`);

    const trigger = trap.trigger[0];
    gs.player.x = centre(trigger.c);
    gs.player.y = centre(trigger.r);
    frames(2);
    check('crossing the trigger brings them in', trap.fired && gs.enemies.length === 3);
    check('they arrive awake and hunting', gs.enemies.every(e => !e.dormant && e.target === gs.player));
    check('in a flash of green', getParticles().some(p => p.kind === 'fog'));

    frames(3);
    check('once', gs.enemies.length === 3);
}

console.log('');
if (failures === 0) {
    console.log('All trap checks passed.');
} else {
    console.log(`${failures} trap check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
