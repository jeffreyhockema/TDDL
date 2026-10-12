// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Door checks. Run with: npm test
 *
 * A keyed door is locked until touched with its key, then slides open for
 * whoever comes near and shuts behind them. Everything that walks, looks,
 * shines or shoots through the map has to agree about whether it is open at
 * this moment -- so the checks here drive the real player, real monsters and
 * the real lighting through one.
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
const { Enemy, Player } = await import('../js/entities.js');
const { Bullet } = await import('../js/weapons.js');
const doors = await import('../js/doors.js');
const { isPathClear, checkWallCollision, isSolidAt } = await import('../js/utils.js');
const { updateLighting, resetLighting, getTileLight } = await import('../js/lighting.js');
const { keys, resetInputState } = await import('../js/input-handler.js');
const { TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_DOOR_RED } = await import('../js/constants.js');
const sprites = await import('../js/enemy-sprites.js');
await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');

console.log = origLog;
console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const { registerDoors, getDoors, doorAtTile, isDoorOpen, unlockDoorAt, updateDoors, DOORS } = doors;

console.log('\n=== doors ===\n');

const gs = new GameState();
gs.selectedDifficulty = 'medium';
gs.currentLevel = 1;

const T = TILE_SIZE;
const WALL = 30;                     // A north-south wall with a doorway at rows 19-20
const centre = (tile) => tile * T + T / 2;

/** A hall split by a wall with a two-tile red door in it. */
function world() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
    for (let r = 2; r < MAP_ROWS - 2; r++) for (let c = 2; c < MAP_COLS - 2; c++) map[r][c] = 0;
    for (let r = 2; r < MAP_ROWS - 2; r++) map[r][WALL] = 1;
    map[19][WALL] = TILE_DOOR_RED;
    map[20][WALL] = TILE_DOOR_RED;

    gs.gameMap = map;
    gs.enemies = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.temporaryVisualEffects = [];
    gs.currentBoss = null;
    gs.player = new Player(centre(27), centre(20));
    gs.player.health = gs.player.maxHealth = 100000;
    gs.player.angle = 0;
    resetInputState();
    resetLighting();
    registerDoors(map);
    return gs.player;
}

function frames(n) {
    for (let i = 0; i < n; i++) {
        gs.frameCount++;
        gs.update();
    }
}

console.log('[registry]');
{
    world();
    check('a door pair registers as one door with two tiles',
        getDoors().length === 1 && getDoors()[0].tiles.length === 2);
    check('both tiles resolve to it', doorAtTile(WALL, 19) === doorAtTile(WALL, 20) && doorAtTile(WALL, 19) !== null);
    check('it stands on the seam between them',
        Math.abs(getDoors()[0].y - (centre(19) + centre(20)) / 2) < 1e-9);
    check('a door starts locked and shut', !getDoors()[0].unlocked && getDoors()[0].openness === 0);
}

console.log('[locking]');
{
    const player = world();
    check('a locked door blocks the player without the key', player.isTileBlocking(WALL, 20));
    player.keysCollected.red = true;
    check('...and with the key, until it is touched', player.isTileBlocking(WALL, 20) && !getDoors()[0].unlocked);

    const door = getDoors()[0];
    const imp = new Enemy(centre(32), centre(20), 'imp');
    imp.acquireTarget(player, false);
    gs.enemies.push(imp);
    frames(60);
    check('a monster cannot open a locked door', door.openness === 0 && !door.unlocked);
    check('...nor walk through it', imp.x > WALL * T + T);
}

console.log('[touch to unlock]');
{
    const player = world();
    player.keysCollected.red = true;
    player.x = centre(WALL - 1);         // right up against it
    const door = getDoors()[0];

    keys.d = true;                       // push east, into the door
    frames(4);
    check('pushing into the door with the key unlocks it', door.unlocked);
    check('it starts to slide open', door.openness > 0 && door.openness < 1);
    check('...and blocks until the gap is wide enough', player.isTileBlocking(WALL, 20));

    frames(DOORS.OPEN_FRAMES);
    check('once open it is passable', isDoorOpen(WALL, 20) && !player.isTileBlocking(WALL, 20));
    check('the tile is still a door', gs.gameMap[20][WALL] === TILE_DOOR_RED);

    frames(60);
    keys.d = false;
    check('the player walks through', player.x > (WALL + 1) * T, `${player.x.toFixed(0)}`);
}

console.log('[automatic]');
{
    const player = world();
    const door = getDoors()[0];
    door.unlocked = true;

    player.x = centre(20);               // ten tiles off: nobody near
    frames(DOORS.CLOSE_DELAY + DOORS.CLOSE_FRAMES + 2);
    check('an unlocked door with nobody near is shut', door.openness === 0);

    player.x = centre(28);               // two tiles off
    frames(DOORS.OPEN_FRAMES + 1);
    check('it opens as the player approaches', door.openness === 1);

    player.x = centre(20);
    frames(DOORS.CLOSE_DELAY - 1);
    check('it waits a moment after they leave', door.openness === 1);
    frames(DOORS.CLOSE_FRAMES + 2);
    check('...then shuts', door.openness === 0);

    player.x = centre(WALL);             // standing in the doorway
    player.y = centre(20);
    frames(DOORS.OPEN_FRAMES + 1);
    door.hold = 0;
    frames(DOORS.CLOSE_DELAY + DOORS.CLOSE_FRAMES + 5);
    check('it never shuts on someone standing in it', door.openness === 1);
}
{
    const player = world();
    const door = getDoors()[0];
    door.unlocked = true;
    player.x = centre(10);
    const demon = new Enemy(centre(32), centre(20), 'demon');
    demon.acquireTarget(player, false);
    gs.enemies.push(demon);
    frames(40);
    check('a monster opens an unlocked door on its way through', door.openness > 0);
    frames(160);
    check('...and comes through it', demon.x < WALL * T, `${demon.x.toFixed(0)}`);
}

console.log('[what passes through]');
{
    const player = world();
    const door = getDoors()[0];
    const from = { x: centre(27), y: centre(20) };
    const to = { x: centre(33), y: centre(20) };

    check('a shut door blocks sight', !isPathClear(from.x, from.y, to.x, to.y, gs.gameMap));
    check('a shut door is solid', isSolidAt(gs.gameMap, WALL, 20) && checkWallCollision(centre(WALL), centre(20), 10, gs.gameMap));
    const shut = new Bullet(centre(WALL), centre(20), 0, 1, 'player', 1);
    check('a shut door stops a bullet', shut.checkWallCollision());

    updateLighting(gs);
    check('a shut door stops light', getTileLight(33, 20) === 0);

    door.unlocked = true;
    door.openness = 1;
    check('an open door lets sight through', isPathClear(from.x, from.y, to.x, to.y, gs.gameMap));
    check('an open door is not solid', !isSolidAt(gs.gameMap, WALL, 20) && !checkWallCollision(centre(WALL), centre(20), 10, gs.gameMap));
    check('an open door lets a bullet through', !shut.checkWallCollision());
    updateLighting(gs);
    check('an open door lets light through', getTileLight(33, 20) > 0, `${getTileLight(33, 20)}`);

    // Half open: still a wall for everything, so nothing slips through a crack.
    door.openness = DOORS.PASSABLE_AT - 0.05;
    check('a door still sliding is still shut', !isPathClear(from.x, from.y, to.x, to.y, gs.gameMap) && isSolidAt(gs.gameMap, WALL, 20));
}

console.log('[sounds]');
{
    world();
    const door = getDoors()[0];
    door.unlocked = true;
    gs.player.x = centre(28);
    const first = updateDoors(gs);
    check('starting to open reports an open sound', first.some(e => e.kind === 'open'));
    let more = 0;
    for (let i = 0; i < DOORS.OPEN_FRAMES + 5; i++) more += updateDoors(gs).length;
    check('...once, not every frame', more === 0);
    gs.player.x = centre(10);
    let closeEvents = 0;
    for (let i = 0; i < DOORS.CLOSE_DELAY + DOORS.CLOSE_FRAMES + 5; i++) {
        closeEvents += updateDoors(gs).filter(e => e.kind === 'close').length;
    }
    check('starting to close reports a close sound, once', closeEvents === 1);
}

console.log('');
if (failures === 0) {
    console.log('All door checks passed.');
} else {
    console.log(`${failures} door check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
