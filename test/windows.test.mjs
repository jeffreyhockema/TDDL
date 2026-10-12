// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Window checks. Run with: npm test
 *
 * A window answers the three questions a tile is asked differently from
 * everything else on the map: solid to bodies, clear to shots, clear to sight
 * and light. That combination is the whole feature, so most of this drives
 * the real player, real bullets and the real lighting at one and checks each
 * answer separately.
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
const { Bullet, traceShot } = await import('../js/weapons.js');
const W = await import('../js/windows.js');
const { planSectors, registerSectors, resetSectors, baseLightAt } = await import('../js/sectors.js');
const { isSolidAt, blocksSightAt, blocksShotsAt, isPathClear } = await import('../js/utils.js');
const { isSolvable, verifyProgression } = await import('../js/level-layout.js');
const { generateMaze } = await import('../js/map-generator.js');
const { updateLighting, resetLighting, getTileLight } = await import('../js/lighting.js');
const { keys, resetInputState } = await import('../js/input-handler.js');
const {
    TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL, TILE_WINDOW, TILE_EXIT,
} = await import('../js/constants.js');
const sprites = await import('../js/enemy-sprites.js');
await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');

console.log = origLog;
console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const { WINDOWS, planWindows, isWindowExterior, isWindowHorizontal } = W;

console.log('\n=== windows ===\n');

const T = TILE_SIZE;
const centre = (tile) => tile * T + T / 2;

/**
 * Two rooms sharing a one-tile wall, with a corridor round the outside so the
 * level is still walkable. The shared wall is where an interior window goes;
 * the rooms' outer walls back onto rock, which is where an exterior one goes.
 */
function shared() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_WALL));
    const left = { x: 10, y: 14, width: 9, height: 10, id: 0, center: { x: 14, y: 18 } };
    const right = { x: 20, y: 14, width: 9, height: 10, id: 1, center: { x: 24, y: 18 } };
    for (const room of [left, right]) {
        for (let r = room.y; r < room.y + room.height; r++) {
            for (let c = room.x; c < room.x + room.width; c++) map[r][c] = TILE_EMPTY;
        }
    }
    // A way round, so both rooms are reachable without crossing the shared wall.
    for (let c = 10; c <= 28; c++) map[25][c] = TILE_EMPTY;
    map[24][10] = TILE_EMPTY;
    map[24][28] = TILE_EMPTY;
    return { map, left, right };
}

// =============================================================================
// THE THREE QUESTIONS
// =============================================================================

console.log('[solid to bodies, clear to shots and sight]');
{
    const { map } = shared();
    const c = 19;                              // the shared wall
    const r = 18;
    map[r][c] = TILE_WINDOW;

    check('a window stops a body', isSolidAt(map, c, r));
    check('...but not a bullet', !blocksShotsAt(map, c, r));
    check('...and not a line of sight', !blocksSightAt(map, c, r));
    check('the wall beside it still stops everything',
        isSolidAt(map, c, r - 1) && blocksShotsAt(map, c, r - 1) && blocksSightAt(map, c, r - 1));

    check('you can see through it', isPathClear(centre(16), centre(r), centre(22), centre(r), map));
    check('...and not through the wall beside it',
        !isPathClear(centre(16), centre(r - 1), centre(22), centre(r - 1), map));
}

console.log('[interior and exterior]');
{
    const { map, left } = shared();
    const interior = { c: 19, r: 18 };         // between the two rooms
    const exterior = { c: left.x - 1, r: 18 }; // the left room's outer wall, rock behind
    map[interior.r][interior.c] = TILE_WINDOW;
    map[exterior.r][exterior.c] = TILE_WINDOW;

    check('a window between two rooms is interior', !isWindowExterior(map, interior.c, interior.r));
    check('a window with rock behind looks outside', isWindowExterior(map, exterior.c, exterior.r));
    check('the shared window is a vertical slot', !isWindowHorizontal(map, interior.c, interior.r));
    const top = { c: 14, r: left.y - 1 };
    map[top.r][top.c] = TILE_WINDOW;
    check('one in a north wall is a horizontal slot', isWindowHorizontal(map, top.c, top.r));
}

console.log('[shots cross, bodies do not]');
{
    const gs = new GameState();
    globalThis.gameState = gs;
    gs.selectedDifficulty = 'medium';
    gs.currentLevel = 2;
    const { map } = shared();
    map[18][19] = TILE_WINDOW;
    gs.gameMap = map;
    gs.enemies = [];
    gs.bullets = [];
    gs.barrels = [];
    gs.explosions = [];
    gs.temporaryVisualEffects = [];
    gs.currentBoss = null;
    gs.decorLights = [];
    resetInputState();

    const player = new Player(centre(17), centre(18));
    gs.player = player;
    player.health = player.maxHealth = 100000;

    // A monster on the far side of the glass.
    const imp = new Enemy(centre(21), centre(18), 'imp');
    imp.ambush = true;
    imp.speed = 0;
    imp.health = 100000;
    gs.enemies.push(imp);

    const hit = traceShot(player.x, player.y, 0, player);
    check('a hitscan shot crosses the glass and finds what is behind it', hit.thing === imp);

    // Straight into the wall a tile up instead.
    const blocked = traceShot(player.x, centre(17), 0, player);
    check('...and the wall beside it stops the same shot', blocked.thing === null);

    // The monster shoots back.
    imp.acquireTarget(player, false);
    const back = imp.traceHitscan(Math.PI);
    check('what is behind the glass can shoot back', back.thing === player);

    // A projectile passes too.
    const ball = new Bullet(centre(17), centre(18), 0, 8, 'enemy', 5);
    gs.bullets.push(ball);
    for (let i = 0; i < 12 && gs.bullets.length; i++) { gs.frameCount++; ball.update(); if (ball.checkWallCollision()) ball.handleWallCollision(); }
    check('a fireball passes through the glass', ball.x > centre(19), `${ball.x.toFixed(0)}`);

    // The player cannot follow it.
    player.x = centre(18);
    player.y = centre(18);
    keys.d = true;
    for (let i = 0; i < 90; i++) { gs.frameCount++; player.update(); }
    keys.d = false;
    check('the player cannot walk through', player.x < 19 * T, `${player.x.toFixed(0)}`);
    check('...nor can a monster', !imp.canStandAt(centre(19), centre(18)));
    delete globalThis.gameState;
}

console.log('[light and daylight]');
{
    const gs = new GameState();
    globalThis.gameState = gs;
    const { map, left, right } = shared();
    map[18][19] = TILE_WINDOW;
    const outer = { c: left.x - 1, r: 18 };
    map[outer.r][outer.c] = TILE_WINDOW;
    gs.gameMap = map;
    gs.enemies = [];
    gs.decorLights = [];
    gs.healthPacks = [];
    gs.ammoPacks = [];

    const runs = [
        { tiles: [{ c: 19, r: 18 }], exterior: false, room: 0 },
        { tiles: [outer], exterior: true, room: 0 },
    ];
    registerSectors(planSectors(map, [left, right], { windows: runs, random: () => 0.9 }));

    const byWindow = baseLightAt(left.x, 18);        // floor in front of the daylight
    const inland = baseLightAt(left.center.x, 22);   // deeper into the same room
    check('daylight lights the floor under an exterior window', byWindow > inland,
        `${byWindow.toFixed(3)} vs ${inland.toFixed(3)}`);

    // Light reaches through the glass into the next room.
    gs.player = new Player(centre(17), centre(18));
    gs.player.angle = 0;
    resetLighting();
    updateLighting(gs);
    const beyond = getTileLight(20, 18);
    const beyondWall = getTileLight(20, 16);
    check('a lit room is visible through the glass', beyond > 0, beyond.toFixed(3));
    check('...and the wall beside it still hides its own row', beyondWall === 0 || beyondWall < beyond);
    resetSectors();
    delete globalThis.gameState;
}

// =============================================================================
// PLACEMENT
// =============================================================================

console.log('[placement]');
{
    const { map, left, right } = shared();
    const before = JSON.parse(JSON.stringify(map));
    const runs = planWindows(map, [left, right], { level: 3, random: () => 0.2 });

    check('windows are cut', runs.length > 0, `${runs.length} runs`);
    check('...no more than the level allows', runs.length <= WINDOWS.MAX_RUNS);

    const all = runs.flatMap(run => run.tiles);
    check('every run is at least two tiles', runs.every(run => run.tiles.length >= WINDOWS.RUN_MIN));
    check('...and its tiles are adjacent', runs.every(run => run.tiles.every((t, i) =>
        i === 0 || Math.abs(t.c - run.tiles[i - 1].c) + Math.abs(t.r - run.tiles[i - 1].r) === 1)));
    check('only wall became window', all.every(t => before[t.r][t.c] === TILE_WALL));
    check('...and every one of them is a window now', all.every(t => map[t.r][t.c] === TILE_WINDOW));

    // A window is a wall to anything that walks, so it cannot change the route.
    const start = { c: left.center.x, r: left.center.y };
    map[25][28] = TILE_EXIT;
    before[25][28] = TILE_EXIT;
    check('cutting windows leaves the level exactly as solvable',
        isSolvable(map, start, MAP_COLS, MAP_ROWS) === isSolvable(before, start, MAP_COLS, MAP_ROWS));

    const reserved = planWindows(shared().map, [left, right], {
        level: 3, random: () => 0.2, isReserved: () => true,
    });
    check('a reserved wall is never cut', reserved.length === 0);
}

console.log('[a generated level]');
{
    globalThis.gameState = { currentLevel: 4, selectedDifficulty: 'medium', player: null };
    let levels = 0;
    let withWindows = 0;
    let exterior = 0;
    let most = 0;
    const problems = [];
    for (let i = 0; i < 6; i++) {
        console.log = noop;
        const data = generateMaze(MAP_COLS, MAP_ROWS, false);
        console.log = origLog;
        if (!data.windows) continue;
        levels++;
        if (data.windows.length) withWindows++;
        exterior += data.windows.filter(run => run.exterior).length;
        most = Math.max(most, data.windows.length);

        for (const run of data.windows) {
            for (const t of run.tiles) {
                if (data.gameMap[t.r][t.c] !== TILE_WINDOW) problems.push(`(${t.c},${t.r}) is not a window`);
            }
        }
        if (!verifyProgression(data.gameMap, data.playerStart, MAP_COLS, MAP_ROWS)) {
            problems.push('a level with windows failed progression');
        }
    }
    delete globalThis.gameState;

    check('generated levels carry windows', levels > 0 && withWindows === levels, `${withWindows} of ${levels}`);
    check('...sparingly', most <= WINDOWS.MAX_RUNS, `at most ${most}`);
    check('...and some of them look outside', exterior > 0, `${exterior}`);
    check('every level still verifies', problems.length === 0, problems.slice(0, 3).join('; '));
}

console.log('');
if (failures === 0) {
    console.log('All window checks passed.');
} else {
    console.log(`${failures} window check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
