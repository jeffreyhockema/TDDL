// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Terrain and tileset tests.  Run with: npm test
 *
 * Covers the three things the terrain feature can get wrong in ways that are not
 * obvious from looking at the screen:
 *
 *   1. Generation. A pool must never be the only way to somewhere. That is a
 *      promise the generator makes and checks, and this proves it keeps it across
 *      a lot of levels rather than the one that happened to be on screen.
 *   2. Damage. Rates are quoted per second but applied per frame, which is exactly
 *      the sort of arithmetic that silently loses a factor of sixty.
 *   3. Lighting. Glowing terrain feeds the light list, and the light list is the
 *      most expensive thing in a frame, so the budget that bounds it has to hold.
 *
 * The autotiling that makes walls and pools read as continuous shapes is covered
 * at the level of the adjacency mask it is driven by; what the shading looks like
 * is a matter of taste and belongs in front of a person, not in an assertion.
 */

// ---------------------------------------------------------------- DOM stubs
const noop = () => {};

function makeCtx() {
    return new Proxy({}, {
        get(_t, prop) {
            if (prop === 'canvas') return { width: 1200, height: 800 };
            if (prop === 'measureText') return () => ({ width: 10 });
            if (prop === 'createRadialGradient') return () => ({ addColorStop: noop });
            if (prop === 'createLinearGradient') return () => ({ addColorStop: noop });
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
globalThis.window = globalThis;
globalThis.document = {
    getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    },
    querySelector: (s) => makeElement(s),
    querySelectorAll: () => [],
    createElement: () => makeElement('created'),
    addEventListener: noop,
    removeEventListener: noop,
    hidden: false,
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.performance = globalThis.performance || { now: () => 0 };
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;

globalThis.gameController = {
    canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop,
};

// ---------------------------------------------------------------- harness
const failures = [];
const check = (name, condition, detail = '') => {
    if (condition) {
        console.log(`  ok    ${name}`);
    } else {
        console.log(`  FAIL  ${name}${detail ? ' -- ' + detail : ''}`);
        failures.push(name);
    }
};

const originalLog = console.log;
const originalWarn = console.warn;
const quiet = (fn) => {
    console.log = noop;
    console.warn = noop;
    try { return fn(); } finally { console.log = originalLog; console.warn = originalWarn; }
};

// ---------------------------------------------------------------- imports
const constants = await quiet(() => import('../js/constants.js'));
const {
    MAP_COLS, MAP_ROWS, TILE_SIZE, TILE_EMPTY, TILE_WALL,
    TILE_LAVA, TILE_TOXIC, TILE_WATER, TERRAIN, TERRAIN_TILES,
    WALL_STYLES, DOOR_STYLES, KEY_STYLES, MINIMAP,
    ANIMATION_TICKS_PER_SECOND, GAME_BALANCE,
} = constants;

const terrain = await import('../js/terrain.js');
const {
    NB, isTerrainTile, getTerrain, isDamagingTerrain, isGlowingTerrain,
    terrainSpeedMultiplier, isWallLike, isKeyedDoor, neighbourMask, tileNoise,
    pickThemeTerrain,
} = terrain;

const { generateMaze } = await quiet(() => import('../js/map-generator.js'));
const { isSolidTile } = await import('../js/utils.js');
const lighting = await import('../js/lighting.js');
const { isOpaqueTile, buildHazardEmitters, collectHazardLights, LIGHTING } = lighting;
const { Player } = await quiet(() => import('../js/entities.js'));
const { keys } = await import('../js/input-handler.js');

console.log('\n=== TDDL terrain and tileset tests ===\n');

// =============================================================================
console.log('[1] The terrain table');
// =============================================================================

check('every terrain tile has a distinct id',
    new Set(TERRAIN_TILES).size === TERRAIN_TILES.length);

check('terrain ids do not collide with any other tile',
    TERRAIN_TILES.every(t => t > 15));

check('lava hurts a lot and toxic waste hurts a little',
    TERRAIN[TILE_LAVA].damagePerSecond > TERRAIN[TILE_TOXIC].damagePerSecond * 3,
    `${TERRAIN[TILE_LAVA].damagePerSecond} vs ${TERRAIN[TILE_TOXIC].damagePerSecond}`);

check('lava is survivable long enough to cross a channel',
    TERRAIN[TILE_LAVA].damagePerSecond < GAME_BALANCE.BASE_PLAYER_HEALTH,
    'a full-health player must survive at least a second in it');

check('water is harmless', TERRAIN[TILE_WATER].damagePerSecond === 0);

check('every liquid slows the player down',
    TERRAIN_TILES.every(t => TERRAIN[t].speed > 0 && TERRAIN[t].speed < 1));

check('lava and toxic waste glow, water does not',
    isGlowingTerrain(TILE_LAVA) && isGlowingTerrain(TILE_TOXIC) && !isGlowingTerrain(TILE_WATER));

check('every terrain tile has a full palette',
    TERRAIN_TILES.every(t => {
        const p = TERRAIN[t].palette;
        return p && p.deep && p.mid && p.hot && p.rim && p.ember;
    }));

check('the accessors agree with the table',
    isTerrainTile(TILE_LAVA) && !isTerrainTile(TILE_WALL) &&
    getTerrain(TILE_TOXIC) === TERRAIN[TILE_TOXIC] && getTerrain(TILE_EMPTY) === null &&
    isDamagingTerrain(TILE_LAVA) && !isDamagingTerrain(TILE_WATER) &&
    terrainSpeedMultiplier(TILE_EMPTY) === 1);

check('terrain neither blocks movement nor stops light',
    TERRAIN_TILES.every(t => !isSolidTile(t) && !isOpaqueTile(t)),
    'a pool is floor, not an obstacle');

check('every level theme names its liquids and its masonry',
    WALL_STYLES.every(s => s.terrain && s.terrain.weights && s.masonry &&
                           s.wall && s.wall.face && s.wall.cap && s.wall.shade &&
                           s.wall.mortar && s.wall.trim));

check('a theme with no lava never rolls lava', (() => {
    const dry = WALL_STYLES.find(s => (s.terrain.weights[TILE_LAVA] || 0) === 0);
    if (!dry) return false;
    for (let i = 0; i < 400; i++) {
        if (pickThemeTerrain(dry) === TILE_LAVA) return false;
    }
    return true;
})());

check('a theme with no liquids at all returns nothing',
    pickThemeTerrain({ terrain: { weights: { [TILE_LAVA]: 0, [TILE_TOXIC]: 0, [TILE_WATER]: 0 } } }) === null);

check('the minimap has a colour for every terrain tile',
    !!MINIMAP.LAVA && !!MINIMAP.TOXIC && !!MINIMAP.WATER);

check('every door has a key in matching colours',
    Object.keys(DOOR_STYLES).length === 3 && Object.keys(KEY_STYLES).length === 3);

// =============================================================================
console.log('\n[2] Adjacency, which is what makes runs continuous');
// =============================================================================

{
    // A 3x3 block of wall with a hole punched in the middle of the top edge:
    //
    //   # # #
    //   # . #        (the centre is open ground)
    //   # # #
    const grid = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_EMPTY));
    for (let r = 10; r <= 12; r++) for (let c = 10; c <= 12; c++) grid[r][c] = TILE_WALL;
    grid[11][11] = TILE_EMPTY;

    const corner = neighbourMask(grid, 10, 10, isWallLike);
    check('an outer corner reports its two open sides',
        !(corner & NB.N) && !(corner & NB.W) && (corner & NB.E) && (corner & NB.S),
        `mask = ${corner}`);

    const beside = neighbourMask(grid, 11, 10, isWallLike);
    check('a block over open ground reports the diagonal too',
        (beside & NB.W) && (beside & NB.E) && !(beside & NB.S),
        `mask = ${beside}`);

    const inner = neighbourMask(grid, 10, 12, isWallLike);
    check('an inner corner keeps both sides but loses the diagonal',
        (inner & NB.N) && (inner & NB.E) && !(inner & NB.NE),
        `mask = ${inner}`);

    const edge = neighbourMask(grid, 0, 0, isWallLike);
    check('tiles off the edge of the world count as solid',
        (edge & NB.N) && (edge & NB.W) && (edge & NB.NW),
        'otherwise every border wall grows a lit face along the void');

    // The same function, asked about a liquid instead. This is the point of it
    // being generic: a lake gets its shoreline from exactly the code a wall gets
    // its edges from.
    const pool = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_EMPTY));
    pool[5][5] = pool[5][6] = pool[6][5] = TILE_LAVA;
    const shore = neighbourMask(pool, 5, 5, (t) => t === TILE_LAVA);
    check('the same mask serves liquids',
        (shore & NB.E) && (shore & NB.S) && !(shore & NB.N) && !(shore & NB.W),
        `mask = ${shore}`);
}

check('tile noise is stable and in range', (() => {
    for (let i = 0; i < 200; i++) {
        const c = i % 50, r = (i * 7) % 40;
        const a = tileNoise(c, r, 3);
        if (a !== tileNoise(c, r, 3)) return false;
        if (!(a >= 0 && a < 1)) return false;
        if (a === tileNoise(c, r, 4)) return false;   // salt must change the draw
    }
    return true;
})());

// =============================================================================
console.log('\n[3] Generation: pools appear, and never bar the way');
// =============================================================================

/** Flood fill from a cell, walking only tiles the filter allows. */
function reachable(map, start, allow) {
    const seen = new Set();
    const stack = [[start.c, start.r]];
    while (stack.length) {
        const [c, r] = stack.pop();
        if (c < 0 || c >= MAP_COLS || r < 0 || r >= MAP_ROWS) continue;
        const code = r * MAP_COLS + c;
        if (seen.has(code)) continue;
        const tile = map[r][c];
        if (tile === TILE_WALL || !allow(tile)) continue;
        seen.add(code);
        stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    return seen;
}

{
    const LEVELS = 60;
    let levelsWithTerrain = 0;
    let totalTerrainTiles = 0;
    let unsafeLevels = 0;
    let crowdedTiles = 0;
    let startsInDanger = 0;
    const kindsSeen = new Set();

    globalThis.gameState = { currentLevel: 1, selectedDifficulty: 'medium' };

    for (let level = 1; level <= LEVELS; level++) {
        globalThis.gameState.currentLevel = level;
        const isBossLevel = level % 5 === 0;

        const result = quiet(() => generateMaze(MAP_COLS, MAP_ROWS, isBossLevel));
        const map = result.gameMap;
        const start = result.playerStart;

        let terrainHere = 0;
        for (let r = 0; r < MAP_ROWS; r++) {
            for (let c = 0; c < MAP_COLS; c++) {
                const tile = map[r][c];
                if (!isTerrainTile(tile)) continue;

                terrainHere++;
                kindsSeen.add(tile);

                // Nothing collectable or openable may sit against a pool, or the
                // player would have to stand in it to use the thing.
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nr = r + dy, nc = c + dx;
                        if (nr < 0 || nr >= MAP_ROWS || nc < 0 || nc >= MAP_COLS) continue;
                        const n = map[nr][nc];
                        if (n === TILE_EMPTY || n === TILE_WALL || isTerrainTile(n)) continue;
                        crowdedTiles++;
                    }
                }
            }
        }

        totalTerrainTiles += terrainHere;
        if (terrainHere > 0) levelsWithTerrain++;

        // The player never wakes up standing in something that burns.
        if (isDamagingTerrain(map[start.r][start.c])) startsInDanger++;

        // The promise: everywhere you could walk, you can still walk to without
        // taking damage on the way.
        const anywhere = reachable(map, start, () => true);
        const safely = reachable(map, start, (t) => !isDamagingTerrain(t));
        for (const code of anywhere) {
            const r = Math.floor(code / MAP_COLS);
            const c = code % MAP_COLS;
            if (safely.has(code) || isDamagingTerrain(map[r][c])) continue;
            unsafeLevels++;
            break;
        }
    }

    check('levels grow terrain', levelsWithTerrain > LEVELS * 0.4,
        `${levelsWithTerrain} of ${LEVELS} levels had any`);
    check('pools are worth drawing', totalTerrainTiles / Math.max(1, levelsWithTerrain) >= 6,
        `${(totalTerrainTiles / Math.max(1, levelsWithTerrain)).toFixed(1)} tiles per wet level`);
    check('all three liquids show up across a run', kindsSeen.size === 3,
        `saw ${[...kindsSeen].map(t => TERRAIN[t].name).join(', ')}`);
    check('nothing collectable or openable touches a pool', crowdedTiles === 0,
        `${crowdedTiles} adjacencies`);
    check('the player never starts in a hazard', startsInDanger === 0);
    check('a hazard is never the only way through', unsafeLevels === 0,
        `${unsafeLevels} of ${LEVELS} levels cut something off`);
}

// =============================================================================
console.log('\n[4] Standing in it');
// =============================================================================

function makeArena(fill) {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_EMPTY));
    for (let c = 0; c < MAP_COLS; c++) { map[0][c] = TILE_WALL; map[MAP_ROWS - 1][c] = TILE_WALL; }
    for (let r = 0; r < MAP_ROWS; r++) { map[r][0] = TILE_WALL; map[r][MAP_COLS - 1] = TILE_WALL; }
    if (fill !== undefined) {
        for (let r = 8; r <= 12; r++) for (let c = 8; c <= 12; c++) map[r][c] = fill;
    }
    return map;
}

/** Drops a player into the middle of an arena flooded with `fill`. */
function standIn(fill) {
    const map = makeArena(fill);
    globalThis.gameState = {
        currentLevel: 1, selectedDifficulty: 'medium', gameMap: map,
        temporaryVisualEffects: [], enemies: [], currentBoss: null,
        beginPlayerDeath: noop,
    };
    const player = quiet(() => new Player(10 * TILE_SIZE + TILE_SIZE / 2,
                                          10 * TILE_SIZE + TILE_SIZE / 2));
    return { player, map };
}

/** Health lost over a second of standing still. */
function damageOverASecond(fill) {
    const { player } = standIn(fill);
    const before = player.health;
    for (let i = 0; i < ANIMATION_TICKS_PER_SECOND; i++) player.applyTerrainEffects();
    return before - player.health;
}

{
    const lava = damageOverASecond(TILE_LAVA);
    const toxic = damageOverASecond(TILE_TOXIC);
    const water = damageOverASecond(TILE_WATER);
    const floor = damageOverASecond(undefined);

    check('lava deals its quoted rate over a second',
        Math.abs(lava - TERRAIN[TILE_LAVA].damagePerSecond) <= 1,
        `${lava} vs ${TERRAIN[TILE_LAVA].damagePerSecond}`);
    check('toxic waste deals its quoted rate over a second',
        Math.abs(toxic - TERRAIN[TILE_TOXIC].damagePerSecond) <= 1,
        `${toxic} vs ${TERRAIN[TILE_TOXIC].damagePerSecond}`);
    check('a rate under a point per frame is not rounded away', toxic > 0,
        'the fractional carry is what makes slow damage work at all');
    check('water and bare floor cost nothing', water === 0 && floor === 0);

    // Leaving and returning must not resume mid-tick, or a player who dips in and
    // out of a pool repeatedly takes damage they never stood still for.
    const { player } = standIn(TILE_LAVA);
    player.applyTerrainEffects();
    player.x = 3 * TILE_SIZE + TILE_SIZE / 2;
    player.applyTerrainEffects();
    check('stepping out clears the accumulated damage',
        player.terrainDamageDebt === 0 && player.terrainTile === TILE_EMPTY);

    // A player standing in lava should die, and reasonably fast.
    const doomed = standIn(TILE_LAVA).player;
    let ticks = 0;
    while (doomed.health > 0 && ticks < ANIMATION_TICKS_PER_SECOND * 10) {
        doomed.applyTerrainEffects();
        ticks++;
    }
    check('lava kills, in between one and four seconds',
        doomed.health === 0 &&
        ticks > ANIMATION_TICKS_PER_SECOND && ticks < ANIMATION_TICKS_PER_SECOND * 4,
        `${(ticks / ANIMATION_TICKS_PER_SECOND).toFixed(2)}s`);
}

{
    // Wading. Movement is driven off the tile recorded by applyTerrainEffects(),
    // so the two have to be run in the order update() runs them.
    const measure = (fill) => {
        const { player } = standIn(fill);
        for (const key of Object.keys(keys)) keys[key] = false;
        keys.d = true;
        player.applyTerrainEffects();
        const before = player.x;
        quiet(() => player.handleMovement());
        keys.d = false;
        return player.x - before;
    };

    const dry = measure(undefined);
    const wet = measure(TILE_WATER);
    const sludge = measure(TILE_TOXIC);

    check('water slows the player down', wet > 0 && wet < dry,
        `${wet.toFixed(2)}px vs ${dry.toFixed(2)}px per frame`);
    check('the slowdown matches the table',
        Math.abs(wet - dry * TERRAIN[TILE_WATER].speed) < 0.001);
    check('sludge slows less than water does', sludge > wet && sludge < dry);
}

// =============================================================================
console.log('\n[5] Glowing terrain as light');
// =============================================================================

{
    const map = makeArena();
    // Two pools far apart, so the per-pool cap has something to spread across.
    for (let r = 5; r <= 9; r++) for (let c = 5; c <= 12; c++) map[r][c] = TILE_LAVA;
    for (let r = 28; r <= 30; r++) for (let c = 40; c <= 44; c++) map[r][c] = TILE_TOXIC;
    // ...and a pond, which must contribute nothing.
    for (let r = 20; r <= 24; r++) for (let c = 20; c <= 26; c++) map[r][c] = TILE_WATER;

    const emitters = buildHazardEmitters(map);
    const pools = new Set(emitters.map(e => e.pool));

    check('every glowing pool gets at least one emitter', pools.size === 2,
        `${pools.size} pools from ${emitters.length} emitters`);
    check('water emits nothing',
        emitters.every(e => e.tile !== TILE_WATER));
    check('a large pool is lit from several points along it',
        emitters.filter(e => e.tile === TILE_LAVA).length > 1);
    check('emitters are far cheaper than one per tile',
        emitters.length < 40 * 0.5,
        `${emitters.length} emitters for 40 lava tiles plus 15 of sludge`);

    check('emitters are spaced out', (() => {
        const byPool = new Map();
        for (const e of emitters) {
            const list = byPool.get(e.pool) || [];
            for (const other of list) {
                const gap = Math.max(Math.abs(other.x - e.x), Math.abs(other.y - e.y)) / TILE_SIZE;
                if (gap < LIGHTING.HAZARD_EMITTER_SPACING - 0.001) return false;
            }
            list.push(e);
            byPool.set(e.pool, list);
        }
        return true;
    })());

    check('every emitter sits on the tile it came from',
        emitters.every(e => {
            const c = Math.floor(e.x / TILE_SIZE);
            const r = Math.floor(e.y / TILE_SIZE);
            return map[r][c] === e.tile;
        }));

    // The frame budget.
    const player = { x: 8 * TILE_SIZE, y: 8 * TILE_SIZE };
    const lights = collectHazardLights(map, player, 0);

    check('the light budget is respected',
        lights.length > 0 && lights.length <= LIGHTING.HAZARD_LIGHT_MAX,
        `${lights.length} lights, cap ${LIGHTING.HAZARD_LIGHT_MAX}`);

    // The cap is a safety valve, not a budget. A pool has to light the whole of
    // itself, from every emitter it has: capping per pool meant a lake lit only the
    // stretch nearest the player, and that bright patch slid along it as they walked
    // past. So nothing within range may be dropped.
    check('every emitter within range is lit', (() => {
        const inRange = emitters.filter(e =>
            Math.hypot(e.x - player.x, e.y - player.y) <= LIGHTING.HAZARD_LIGHT_CULL).length;
        return lights.length === Math.min(inRange, LIGHTING.HAZARD_LIGHT_MAX);
    })(), `${lights.length} lit of ${emitters.length} emitters`);

    // Terrain glow is gated through the sightline, so an emitter beyond sight
    // contributes nothing whatever it does. Culling any nearer than that puts a
    // second, invisible edge inside the first, and pools wink out in plain view.
    check('nothing is culled while it could still be seen',
        LIGHTING.HAZARD_LIGHT_CULL >= LIGHTING.SIGHT_RANGE,
        `cull ${LIGHTING.HAZARD_LIGHT_CULL / TILE_SIZE} tiles, ` +
        `sight ${LIGHTING.SIGHT_RANGE / TILE_SIZE} tiles`);

    check('terrain lights are cheap ones',
        lights.every(l => l.kind === 'point' && l.originCount === LIGHTING.HAZARD_LIGHT_ORIGINS &&
                          l.arcDegrees >= LIGHTING.RAY_ARC_DEGREES),
        'a full-quality cast per pool would cost more than the flashlight');

    check('terrain lights are coloured and finite',
        lights.every(l => typeof l.color === 'string' && l.range > 0 &&
                          Number.isFinite(l.intensity) && l.intensity > 0));

    check('the flicker actually moves', (() => {
        const a = collectHazardLights(map, player, 0)[0];
        const b = collectHazardLights(map, player, 400)[0];
        return a && b && a.intensity !== b.intensity;
    })());

    check('pools far from the player are not cast at all', (() => {
        const remote = { x: 46 * TILE_SIZE, y: 36 * TILE_SIZE };
        const far = collectHazardLights(map, remote, 0);
        // Standing in the far corner, the lava field 30-odd tiles away is out of
        // range; only the sludge nearby should be burning.
        return far.every(l => l.range === TERRAIN[TILE_TOXIC].glow.range);
    })());

    check('a dry map costs nothing',
        collectHazardLights(makeArena(), player, 0).length === 0);
}

// ---------------------------------------------------------------- result
console.log('');
if (failures.length > 0) {
    console.log(`${failures.length} terrain FAILURE(S):`);
    for (const name of failures) console.log(`  - ${name}`);
    process.exit(1);
}
console.log('All terrain checks passed.');
