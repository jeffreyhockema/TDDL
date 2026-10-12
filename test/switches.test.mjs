// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Switch checks. Run with: npm test
 *
 * A switch is pressed by touch or by a shot and works once; what it works is
 * a wall that slides, or a closet that opens. The planning half must never
 * make a level harder to finish; the runtime half must move the wall and let
 * bodies, sight and light through only once it has.
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
const { Bullet } = await import('../js/weapons.js');
const sw = await import('../js/switches.js');
const { planTraps, planCloset, triggerTilesFor } = await import('../js/traps.js');
const { verifyProgression } = await import('../js/level-layout.js');
const { validateMapConnectivity, generateMaze } = await import('../js/map-generator.js');
const { isPathClear, isSolidAt } = await import('../js/utils.js');
const { updateLighting, resetLighting, getTileLight } = await import('../js/lighting.js');
const { keys, resetInputState } = await import('../js/input-handler.js');
const { TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL, TILE_SLIDE, TILE_SWITCH, TILE_KEY_RED, TILE_EXIT } = await import('../js/constants.js');
const sprites = await import('../js/enemy-sprites.js');
await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');

console.log = origLog;
console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const { SWITCHES, planSwitches, registerSwitches, getSwitches, getSlides, switchAtTile, slideAtTile, isSlideOpen, pressSwitchAt, updateSwitches } = sw;

console.log('\n=== switches ===\n');

const T = TILE_SIZE;
const centre = (tile) => tile * T + T / 2;

/** Two rooms, a corridor, a key and an exit: a level the verifier can judge. */
function level() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_WALL));
    const start = { x: 6, y: 20, width: 6, height: 5, id: 0, role: 'start', center: { x: 9, y: 22 } };
    const room = { x: 24, y: 16, width: 12, height: 10, id: 1, role: 'transit', center: { x: 30, y: 21 } };
    for (const r of [start, room]) for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) map[y][x] = TILE_EMPTY;
    for (let x = 12; x < 24; x++) { map[21][x] = TILE_EMPTY; map[22][x] = TILE_EMPTY; }
    map[24][34] = TILE_EXIT;
    return { map, start, room, playerStart: { c: 9, r: 22 } };
}

// =============================================================================
// PLANNING
// =============================================================================

console.log('[planning]');
{
    const { map, start, room, playerStart } = level();
    check('level 1 has no switches', planSwitches(map, [start, room], start, { level: 1 }).switches.length === 0);

    const plan = planSwitches(map, [start, room], start, { level: 5, random: () => 0.1 });
    check('a level plans an alcove', plan.slides.length === 1 && plan.switches.length >= 1);
    const slide = plan.slides[0];
    const s = plan.switches.find(x => x.effect.kind === 'slide');
    check('the alcove is sealed by sliding wall', slide.tiles.every(t => map[t.r][t.c] === TILE_SLIDE));
    check('...with something worth having inside', slide.pocket.some(t => map[t.r][t.c] >= 9 && map[t.r][t.c] <= 15));
    check('the switch is a wall tile of the same room', map[s.r][s.c] === TILE_SWITCH && s.room === room.id);
    const sideOf = (t) => t.r < room.y ? 'N' : t.r >= room.y + room.height ? 'S' : t.c < room.x ? 'W' : 'E';
    check('...on a different wall from the alcove', sideOf(s) !== sideOf(slide.tiles[0]));
    check('...and fronting the floor', [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dc, dr]) => map[s.r + dr] && map[s.r + dr][s.c + dc] === TILE_EMPTY));
    check('the level still verifies', verifyProgression(map, playerStart, MAP_COLS, MAP_ROWS) && validateMapConnectivity(map, playerStart));
    check('the alcove is not the way to anything', slide.pocket.every(t => isSolidAt(map, slide.tiles[0].c, slide.tiles[0].r)));
}
{
    // A closet on a switch
    const { map, start, room } = level();
    const closet = planCloset(map, room, () => 0.3, () => false);
    const trap = { kind: 'closet', room: room.id, trigger: triggerTilesFor(map, room), pocket: closet.pocket, door: closet.door, facing: closet.facing, monsters: ['imp', 'imp'], fired: false };
    // First roll skips the alcove, the next takes the closet
    let roll = 0;
    const plan = planSwitches(map, [start, room], start, { level: 5, random: () => (roll++ === 0 ? 0.9 : 0.3), traps: [trap] });
    const wired = plan.switches.find(x => x.effect.kind === 'trap');
    check('a closet can be wired to a switch', !!wired && wired.effect.trap === 0);
    check('...which takes over from its floor trigger', trap.trigger.length === 0 && trap.switched === true);
}
{
    globalThis.gameState = { currentLevel: 6, selectedDifficulty: 'medium', player: null };
    let levels = 0, withSwitches = 0, most = 0;
    for (let i = 0; i < 4; i++) {
        console.log = noop;
        const data = generateMaze(MAP_COLS, MAP_ROWS, false);
        console.log = origLog;
        if (!data.switchPlan) continue;
        levels++;
        if (data.switchPlan.switches.length > 0) withSwitches++;
        most = Math.max(most, data.switchPlan.switches.length);
    }
    check('generated levels carry a switch or two, not more', levels > 0 && most <= SWITCHES.MAX_PER_LEVEL, `${withSwitches} of ${levels}, at most ${most}`);
    delete globalThis.gameState;
}

// =============================================================================
// RUNTIME
// =============================================================================

const gs = new GameState();
gs.selectedDifficulty = 'medium';
gs.currentLevel = 5;

/** A room with a switch on its north wall and a two-tile sliding wall on its east. */
function live() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_WALL));
    for (let y = 16; y < 26; y++) for (let x = 20; x < 32; x++) map[y][x] = TILE_EMPTY;
    // The alcove behind the east wall
    map[20][32] = TILE_SLIDE; map[21][32] = TILE_SLIDE;
    map[20][33] = TILE_EMPTY; map[21][33] = TILE_EMPTY;
    // The switch in the north wall
    map[15][26] = TILE_SWITCH;
    gs.gameMap = map;
    gs.enemies = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.barrels = [];
    gs.traps = [];
    gs.temporaryVisualEffects = [];
    gs.currentBoss = null;
    gs.player = new Player(centre(26), centre(17));
    gs.player.health = gs.player.maxHealth = 100000;
    resetInputState();
    resetLighting();
    registerSwitches({
        slides: [{ tiles: [{ c: 32, r: 20 }, { c: 32, r: 21 }], dir: [0, 1] }],
        switches: [{ c: 26, r: 15, face: 'N', room: 0, effect: { kind: 'slide', slide: 0 } }],
    });
    return gs.player;
}

function frames(n) {
    for (let i = 0; i < n; i++) {
        gs.frameCount++;
        gs.update();
    }
}

console.log('[a switch and a wall]');
{
    const player = world_();
    function world_() { return live(); }
    check('the registry knows the switch and the wall', !!switchAtTile(26, 15) && !!slideAtTile(32, 20) && !switchAtTile(26, 15).on);
    check('the wall is shut', !isSlideOpen(32, 20) && isSolidAt(gs.gameMap, 32, 20) && player.isTileBlocking(32, 20));
    check('...to sight', !isPathClear(centre(28), centre(20), centre(33), centre(20), gs.gameMap));

    keys.w = true;                       // push north, into the switch
    frames(30);
    keys.w = false;
    check('pushing into the switch presses it', switchAtTile(26, 15).on);
    check('the wall starts to slide', slideAtTile(32, 20).openness > 0 && slideAtTile(32, 20).openness < SWITCHES.PASSABLE_AT);
    check('...and is still shut', isSolidAt(gs.gameMap, 32, 20));

    frames(SWITCHES.SLIDE_FRAMES);
    check('once it has slid clear it is open', isSlideOpen(32, 20) && !isSolidAt(gs.gameMap, 32, 20) && !player.isTileBlocking(32, 20));
    check('...to sight', isPathClear(centre(28), centre(20), centre(33), centre(20), gs.gameMap));
    player.x = centre(28); player.y = centre(20); player.angle = 0;
    updateLighting(gs);
    check('...and to light', getTileLight(33, 20) > 0, `${getTileLight(33, 20)}`);
    check('the tiles are still sliding-wall tiles', gs.gameMap[20][32] === TILE_SLIDE);
    check('a switch works once', pressSwitchAt(26, 15) === null);
}

console.log('[shooting it]');
{
    live();
    const bullet = new Bullet(centre(26), centre(16), -Math.PI / 2, 12, 'player', 10);
    gs.bullets.push(bullet);
    frames(4);
    check('a shot presses a switch', switchAtTile(26, 15).on);
    live();
    const hostile = new Bullet(centre(26), centre(16), -Math.PI / 2, 12, 'enemy', 10);
    gs.bullets.push(hostile);
    frames(4);
    check('a monster shot does not', !switchAtTile(26, 15).on);
}

console.log('[a closet on a switch]');
{
    const player = live();
    const room = { x: 20, y: 16, width: 12, height: 10, id: 0, role: 'transit', center: { x: 26, y: 21 } };
    const closet = planCloset(gs.gameMap, room, () => 0.7, () => false);
    const trap = { kind: 'closet', room: 0, trigger: [], pocket: closet.pocket, door: closet.door, facing: closet.facing, monsters: ['imp', 'imp'], fired: false, switched: true };
    gs.traps = [trap];
    gs.armTraps();
    registerSwitches({ slides: [], switches: [{ c: 26, r: 15, face: 'N', room: 0, effect: { kind: 'trap', trap: 0 } }] });

    player.x = centre(room.center.x); player.y = centre(room.center.y);
    frames(20);
    check('walking the room does not open a switched closet', !trap.fired && trap.enemies.every(e => e.dormant));

    gs.pressSwitchAt(26, 15);
    frames(2);
    check('pressing the switch does', trap.fired && trap.door.every(t => gs.gameMap[t.r][t.c] === TILE_EMPTY) && trap.enemies.every(e => !e.dormant));
}

console.log('');
if (failures === 0) {
    console.log('All switch checks passed.');
} else {
    console.log(`${failures} switch check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
