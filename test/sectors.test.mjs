// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Sector lighting checks. Run with: npm test
 *
 * Doom's ambient model: every sector carries a light level, rooms are flat
 * across their own level, corridors run darker, some sectors blink. Here that
 * has to hold, and it has to stay gated on line of sight -- a lit room is lit
 * when you can see into it and black until then, or the lighting hands the
 * player the map.
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
const { Player } = await import('../js/entities.js');
const S = await import('../js/sectors.js');
const { updateLighting, resetLighting, getTileLight, isTileLit, isTileInSight, LIGHTING } = await import('../js/lighting.js');
const { generateMaze } = await import('../js/map-generator.js');
const { TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL } = await import('../js/constants.js');
const sprites = await import('../js/enemy-sprites.js');
await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');

console.log = origLog;
console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const { SECTORS, planSectors, registerSectors, resetSectors, ambientAt, baseLightAt,
        ambientForTile, hasSectors, updateSectors, getSpecials } = S;

console.log('\n=== sector lighting ===\n');

const T = TILE_SIZE;
const centre = (tile) => tile * T + T / 2;

/** Two rooms joined by a corridor, on a solid field. */
function twoRooms() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_WALL));
    const a = { x: 6, y: 16, width: 8, height: 8, id: 0, center: { x: 9, y: 19 } };
    const b = { x: 26, y: 16, width: 8, height: 8, id: 1, center: { x: 29, y: 19 } };
    for (const room of [a, b]) {
        for (let r = room.y; r < room.y + room.height; r++) {
            for (let c = room.x; c < room.x + room.width; c++) map[r][c] = TILE_EMPTY;
        }
    }
    for (let c = 14; c < 26; c++) { map[19][c] = TILE_EMPTY; map[20][c] = TILE_EMPTY; }
    return { map, rooms: [a, b] };
}

// =============================================================================
// THE MODEL
// =============================================================================

console.log('[a room is a sector]');
{
    const { map, rooms } = twoRooms();
    const plan = planSectors(map, rooms, { random: () => 0.5 });
    registerSectors(plan);

    check('the level has lighting', hasSectors());

    // Every tile of a room shares one level, as a Doom sector does.
    const levels = new Set();
    for (let r = rooms[0].y; r < rooms[0].y + rooms[0].height; r++) {
        for (let c = rooms[0].x; c < rooms[0].x + rooms[0].width; c++) {
            levels.add(baseLightAt(c, r).toFixed(4));
        }
    }
    check('a room is flat across its own level', levels.size === 1, `${levels.size} levels in one room`);
    check('...and it is lit at all', baseLightAt(rooms[0].center.x, rooms[0].center.y) > 0);
    check('nothing exceeds the ambient ceiling',
        baseLightAt(rooms[0].center.x, rooms[0].center.y) <= SECTORS.MAX_AMBIENT + 1e-9);
    check('solid rock has no light', baseLightAt(0, 0) === 0);

    // Corridors run darker than the rooms they join. Sampled at the middle of
    // the run, past the spill from either end.
    const roomLight = baseLightAt(rooms[0].x + 1, rooms[0].y + 1);
    const corridor = baseLightAt(20, 19);
    check('the corridor is darker than the rooms it joins', corridor < roomLight,
        `corridor ${corridor.toFixed(3)} vs room ${roomLight.toFixed(3)}`);

    // Light bleeds through a doorway rather than stopping dead at it.
    const atDoor = baseLightAt(14, 19);
    const deeper = baseLightAt(18, 19);
    check('light spills out of a doorway and fades along the corridor',
        atDoor > deeper, `${atDoor.toFixed(3)} then ${deeper.toFixed(3)}`);
}

console.log('[a wall takes its light from the floor it faces]');
{
    const { map, rooms } = twoRooms();
    registerSectors(planSectors(map, rooms, { random: () => 0.5 }));

    const room = rooms[0];
    const floor = ambientForTile(map, room.x, room.y);
    const facing = ambientForTile(map, room.x - 1, room.y);      // wall on the room's edge
    const buried = ambientForTile(map, 0, 0);                    // rock, facing nothing

    check('a wall fronting a lit room is lit', facing > 0);
    check('...a shade under the floor it faces',
        Math.abs(facing - floor * SECTORS.WALL_SHARE) < 1e-6,
        `${facing.toFixed(3)} vs ${(floor * SECTORS.WALL_SHARE).toFixed(3)}`);
    check('rock with no room against it stays black', buried === 0);
}

console.log('[room kind biases the level]');
{
    const { map, rooms } = twoRooms();
    const sample = (kind) => {
        let total = 0;
        for (let i = 0; i < 200; i++) {
            const plan = planSectors(map, rooms, { roomKinds: { 0: kind }, random: Math.random });
            total += plan.baseLevel[rooms[0].center.y * MAP_COLS + rooms[0].center.x];
        }
        return total / 200;
    };
    const lab = sample('lab');
    const crypt = sample('crypt');
    check('a laboratory is lit and a crypt is not', lab > crypt,
        `lab ${lab.toFixed(3)} vs crypt ${crypt.toFixed(3)}`);
}

console.log('[light specials]');
{
    const { map, rooms } = twoRooms();
    // Force a special onto the first room and drive its clock.
    const plan = planSectors(map, rooms, { random: () => 0.01 });
    registerSectors(plan);
    check('a level can carry light specials', getSpecials().length > 0, `${getSpecials().length}`);

    const { x, y } = rooms[0].center;
    const base = baseLightAt(x, y);
    let low = Infinity;
    let high = -Infinity;
    for (let ms = 0; ms < 6000; ms += 20) {
        updateSectors(ms);
        const now = ambientAt(x, y);
        low = Math.min(low, now);
        high = Math.max(high, now);
    }
    check('a special swings between dark and its own level', low < high);
    check('...never above its steady level', high <= base + 1e-9,
        `${high.toFixed(3)} vs ${base.toFixed(3)}`);
    check('...and never to nothing', low > 0, low.toFixed(4));

    // Each kind behaves as Doom's does.
    for (const kind of ['blink', 'flicker', 'glow']) {
        registerSectors({
            baseLevel: new Float32Array(MAP_COLS * MAP_ROWS).fill(0.4),
            specialOf: new Int8Array(MAP_COLS * MAP_ROWS).fill(0),
            specials: [{ kind, period: 1, dark: 0.3, phase: 0, seed: 1 }],
        });
        const seen = new Set();
        for (let ms = 0; ms < 4000; ms += 10) {
            updateSectors(ms);
            seen.add(ambientAt(5, 5).toFixed(3));
        }
        if (kind === 'glow') {
            check(`a ${kind} swells smoothly through many levels`, seen.size > 20, `${seen.size} levels`);
        } else {
            check(`a ${kind} switches between two levels`, seen.size === 2, `${seen.size} levels`);
        }
    }
    resetSectors();
    check('a cleared level is dark again', !hasSectors() && ambientAt(5, 5) === 0);
}

// =============================================================================
// IN THE GAME
// =============================================================================

console.log('[gated on line of sight]');
{
    const gs = new GameState();
    gs.selectedDifficulty = 'medium';
    gs.currentLevel = 2;
    const { map, rooms } = twoRooms();
    gs.gameMap = map;
    gs.enemies = [];
    gs.decorLights = [];
    gs.healthPacks = [];
    gs.ammoPacks = [];
    // A bright, steady level everywhere, so anything unlit is the gate's doing.
    const size = MAP_COLS * MAP_ROWS;
    const level = new Float32Array(size);
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            if (map[r][c] !== TILE_WALL) level[r * MAP_COLS + c] = 0.5;
        }
    }
    registerSectors({ baseLevel: level, specialOf: new Int8Array(size).fill(-1), specials: [] });

    gs.player = new Player(centre(rooms[0].center.x), centre(rooms[0].center.y));
    gs.player.angle = 0;                       // face east, toward the corridor
    resetLighting();
    updateLighting(gs);

    // What gates ambient is rock, not where the player happens to be looking
    // (see the sightline in js/lighting.js): you take in the whole of the room
    // you are standing in, and the torch is what reaches beyond it. So the room
    // is lit all round...
    const ahead = getTileLight(rooms[0].x + rooms[0].width - 1, rooms[0].center.y);
    const behind = getTileLight(rooms[0].x, rooms[0].center.y);
    check('the room the player stands in is lit right across',
        ahead > LIGHTING.MEMORY_MIN_LIGHT && behind > LIGHTING.MEMORY_MIN_LIGHT,
        `ahead ${ahead.toFixed(3)}, behind ${behind.toFixed(3)}`);

    // ...and the gate that decides it does not care which way you face. (The
    // total at a tile does change, because the torch is part of it; the gate
    // is the facing-independent half.)
    const seenFacingEast = isTileInSight(rooms[0].x, rooms[0].center.y);
    gs.player.angle = Math.PI;
    updateLighting(gs);
    check('the gate does not care which way the player faces',
        seenFacingEast && isTileInSight(rooms[0].x, rooms[0].center.y));
    gs.player.angle = 0;
    updateLighting(gs);

    // The corridor is two tiles tall at rows 19-20, so the far room's top row
    // is behind rock however far down the corridor there is a line.
    const hidden = getTileLight(rooms[1].x + 3, rooms[1].y);
    check('a corner with rock in the way stays black', hidden === 0, hidden.toFixed(3));
    check('...and is not counted as lit', !isTileLit(rooms[1].x + 3, rooms[1].y));

    // Walk into the far room and that corner resolves.
    gs.player.x = centre(rooms[1].center.x);
    gs.player.y = centre(rooms[1].center.y);
    updateLighting(gs);
    const nowSeen = getTileLight(rooms[1].x + 3, rooms[1].y);
    check('standing in the room, that corner lights up',
        nowSeen > LIGHTING.MEMORY_MIN_LIGHT, nowSeen.toFixed(3));

    resetSectors();
}

console.log('[a generated level]');
{
    globalThis.gameState = { currentLevel: 4, selectedDifficulty: 'medium', player: null };
    console.log = noop;
    const data = generateMaze(MAP_COLS, MAP_ROWS, false);
    console.log = origLog;
    delete globalThis.gameState;

    check('the generator produces sector lighting', !!data.sectors && !!data.sectors.baseLevel);
    registerSectors(data.sectors);

    let lit = 0;
    let open = 0;
    const levels = new Set();
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            if (data.gameMap[r][c] === TILE_WALL) continue;
            open++;
            const value = baseLightAt(c, r);
            if (value > 0) lit++;
            levels.add(value.toFixed(3));
        }
    }
    check('every walkable tile has a light level', lit === open, `${lit} of ${open}`);
    check('the level is not one flat brightness', levels.size > 3, `${levels.size} distinct levels`);
    check('nothing exceeds the ceiling',
        [...levels].every(v => Number(v) <= SECTORS.MAX_AMBIENT + 1e-9));
    resetSectors();
}

console.log('');
if (failures === 0) {
    console.log('All sector lighting checks passed.');
} else {
    console.log(`${failures} sector lighting check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
