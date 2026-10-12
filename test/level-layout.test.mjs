// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Level layout tests. Run with: npm test
 *
 * These are the tests the old generator could not have passed. It placed keys at
 * random and then hunted for a door location that did not soft-lock the level, so
 * "is this level completable" was something it discovered, sometimes, after the
 * fact. The zoned generator decides the progression first and lays the space out
 * to fit, so completability is a property of the construction -- and that is what
 * is asserted here, over hundreds of levels rather than one lucky seed.
 *
 * The strongest check is not "can the exit be reached". It is that removing any
 * single key makes the exit unreachable: that is the difference between a level
 * that happens to have keys lying around in it and a level that is ABOUT keys.
 */

globalThis.window = globalThis;
globalThis.gameState = { currentLevel: 1 };

const { buildDoomLayout, verifyProgression, isSolvable, PROGRESSION, LAYOUT_CONFIG } =
    await import('../js/level-layout.js');
const { generateMaze, validateMapConnectivity } = await import('../js/map-generator.js');
const {
    MAP_COLS, MAP_ROWS, WALL_STYLES,
    TILE_EMPTY, TILE_WALL, TILE_EXIT,
    TILE_DOOR_RED, TILE_DOOR_YELLOW, TILE_DOOR_BLUE,
    TILE_KEY_RED, TILE_KEY_YELLOW, TILE_KEY_BLUE,
    TILE_SECRET_DOOR, TERRAIN_TILES
} = await import('../js/constants.js');

// ------------------------------------------------------------------ harness

let failures = 0;
let checks = 0;

function check(condition, message) {
    checks++;
    if (!condition) {
        failures++;
        console.error(`  FAIL: ${message}`);
    }
}

function section(name) {
    console.log(`\n[level-layout] ${name}`);
}

// The generators are chatty; only warnings and errors are interesting here.
const realLog = console.log;
function quietly(fn) {
    console.log = () => {};
    try {
        return fn();
    } finally {
        console.log = realLog;
    }
}

// ------------------------------------------------------------------ helpers

const DOOR_TILES = [TILE_DOOR_RED, TILE_DOOR_YELLOW, TILE_DOOR_BLUE];
const KEY_TILES = [TILE_KEY_RED, TILE_KEY_YELLOW, TILE_KEY_BLUE];

/** Whether a tile can be stood on (everything except solid rock and secret doors). */
function isOpen(map, x, y) {
    if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) return false;
    const tile = map[y][x];
    return tile !== TILE_WALL && tile !== TILE_SECRET_DOOR;
}

/** Whether a tile falls inside one of the listed rooms. */
function insideAnyRoom(rooms, x, y) {
    return rooms.some(room =>
        x >= room.x && x < room.x + room.width &&
        y >= room.y && y < room.y + room.height);
}

/**
 * Whether a tile belongs to some 2x2 block of open tiles -- the test for "this is
 * part of a two-wide passage" that does not care which way the passage runs.
 */
function inTwoWideBlock(map, x, y) {
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        if (isOpen(map, x + ox, y + oy) && isOpen(map, x + ox + 1, y + oy) &&
            isOpen(map, x + ox, y + oy + 1) && isOpen(map, x + ox + 1, y + oy + 1)) {
            return true;
        }
    }
    return false;
}

/** Every tile of a given type, as {x, y}. */
function findTiles(map, tile) {
    const found = [];
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            if (map[y][x] === tile) found.push({ x, y });
        }
    }
    return found;
}

/** Which of the layout's zones a tile sits in, or -1. */
function zoneOfTile(zones, x, y) {
    for (const zone of zones) {
        const r = zone.rect;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return zone.id;
    }
    return -1;
}

// ------------------------------------------------------------------ structure

section('zoned layout structure (200 layouts)');
{
    const LAYOUTS = 200;
    let built = 0;
    let narrowTiles = 0;
    let corridorTiles = 0;
    const roomCounts = [];

    for (let i = 0; i < LAYOUTS; i++) {
        const keyCount = 1 + (i % PROGRESSION.length);
        const layout = quietly(() => buildDoomLayout(MAP_COLS, MAP_ROWS, { keyCount }));

        if (!layout) continue;
        built++;
        roomCounts.push(layout.rooms.length);

        check(layout.zones.length === layout.keyCount + 1,
            `layout ${i}: ${layout.zones.length} zones for ${layout.keyCount} keys`);
        check(layout.keyCount === keyCount,
            `layout ${i}: asked for ${keyCount} keys, got ${layout.keyCount}`);

        // --- The whole point: solvable, and every key genuinely gates something.
        check(verifyProgression(layout.map, layout.playerStart, MAP_COLS, MAP_ROWS),
            `layout ${i}: progression does not verify`);

        // --- Doors span the full width of their corridor, in a matched pair.
        for (let stage = 0; stage < layout.keyCount; stage++) {
            const door = PROGRESSION[stage].door;
            const tiles = findTiles(layout.map, door);
            check(tiles.length === LAYOUT_CONFIG.CORRIDOR_WIDTH,
                `layout ${i}: ${PROGRESSION[stage].name} door is ${tiles.length} tiles, want ${LAYOUT_CONFIG.CORRIDOR_WIDTH}`);

            if (tiles.length === 2) {
                const [a, b] = tiles;
                const adjacent = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
                check(adjacent, `layout ${i}: ${PROGRESSION[stage].name} door tiles are not adjacent`);
            }

            // A door with no key would be a wall with extra steps.
            check(findTiles(layout.map, PROGRESSION[stage].key).length === 1,
                `layout ${i}: expected exactly one ${PROGRESSION[stage].name} key`);
        }

        // Unused colours must not appear at all.
        for (let stage = layout.keyCount; stage < PROGRESSION.length; stage++) {
            check(findTiles(layout.map, PROGRESSION[stage].door).length === 0,
                `layout ${i}: unused ${PROGRESSION[stage].name} door present`);
            check(findTiles(layout.map, PROGRESSION[stage].key).length === 0,
                `layout ${i}: unused ${PROGRESSION[stage].name} key present`);
        }

        check(findTiles(layout.map, TILE_EXIT).length === 1, `layout ${i}: expected exactly one exit`);

        // --- Mission items land in the zone the progression put them in.
        for (let stage = 0; stage < layout.keyCount; stage++) {
            const [key] = findTiles(layout.map, PROGRESSION[stage].key);
            if (!key) continue;
            check(zoneOfTile(layout.zones, key.x, key.y) === stage,
                `layout ${i}: ${PROGRESSION[stage].name} key is in zone ` +
                `${zoneOfTile(layout.zones, key.x, key.y)}, want zone ${stage}`);
        }

        const [exit] = findTiles(layout.map, TILE_EXIT);
        if (exit) {
            check(zoneOfTile(layout.zones, exit.x, exit.y) === layout.zones.length - 1,
                `layout ${i}: exit is not in the final zone`);
        }

        check(zoneOfTile(layout.zones, layout.playerStart.c, layout.playerStart.r) === 0,
            `layout ${i}: player does not start in zone 0`);

        // The key must not be the first thing you meet on the way in.
        for (let stage = 0; stage < layout.keyCount; stage++) {
            check(layout.keyRooms[stage] !== layout.playerStartRoom || stage !== 0 ||
                  layout.zones[0].rooms.length < 2,
                `layout ${i}: red key is in the room the player starts in`);
        }

        // --- Hallways are two tiles wide. Room interiors are exempt: obstacles and
        // pillars inside a room are meant to pinch, that is what makes cover.
        for (let y = 0; y < MAP_ROWS; y++) {
            for (let x = 0; x < MAP_COLS; x++) {
                if (!isOpen(layout.map, x, y)) continue;
                if (insideAnyRoom(layout.rooms, x, y)) continue;
                corridorTiles++;
                if (!inTwoWideBlock(layout.map, x, y)) narrowTiles++;
            }
        }
    }

    check(built === LAYOUTS, `only ${built} of ${LAYOUTS} layouts built`);
    check(narrowTiles === 0,
        `${narrowTiles} of ${corridorTiles} corridor tiles are not part of a two-wide passage`);

    const averageRooms = roomCounts.reduce((sum, n) => sum + n, 0) / Math.max(roomCounts.length, 1);
    check(averageRooms >= 10, `average of ${averageRooms.toFixed(1)} rooms per level is too sparse`);
    check(Math.min(...roomCounts) >= 6, `a level came out with only ${Math.min(...roomCounts)} rooms`);

    console.log(`  ${built}/${LAYOUTS} built, ${averageRooms.toFixed(1)} rooms avg, ` +
                `${corridorTiles} corridor tiles checked`);
}

// ------------------------------------------------------------------ gating

section('every key is load-bearing (150 layouts)');
{
    const LAYOUTS = 150;
    let checked = 0;

    for (let i = 0; i < LAYOUTS; i++) {
        const layout = quietly(() => buildDoomLayout(MAP_COLS, MAP_ROWS, { keyCount: 3 }));
        if (!layout) continue;
        checked++;

        check(isSolvable(layout.map, layout.playerStart, MAP_COLS, MAP_ROWS),
            `layout ${i}: not solvable with every key available`);

        // Take one key away at a time. Each removal must strand the player, which
        // proves the door that key opens is the only way through.
        for (let stage = 0; stage < layout.keyCount; stage++) {
            const stripped = layout.map.map(row =>
                row.map(tile => (tile === PROGRESSION[stage].key ? TILE_EMPTY : tile)));
            check(!isSolvable(stripped, layout.playerStart, MAP_COLS, MAP_ROWS),
                `layout ${i}: exit still reachable without the ${PROGRESSION[stage].name} key`);
        }

        // And with no keys at all the player should not get anywhere near the exit.
        const noKeys = layout.map.map(row =>
            row.map(tile => (KEY_TILES.includes(tile) ? TILE_EMPTY : tile)));
        check(!isSolvable(noKeys, layout.playerStart, MAP_COLS, MAP_ROWS),
            `layout ${i}: exit reachable with no keys at all`);
    }

    check(checked === LAYOUTS, `only ${checked} of ${LAYOUTS} layouts built`);
    console.log(`  ${checked} layouts, ${checked * 4} gating checks`);
}

// ------------------------------------------------------------------ partition

section('zone rectangles partition the map (200 layouts)');
{
    // The zones are the level's skeleton, and a rectangle that overruns its parent
    // is invisible until something reads it: rooms are inset far enough to absorb a
    // small overrun, so the first symptom would be a corridor writing off the end
    // of the map, or the wrong zone's look painted along an edge.
    const LAYOUTS = 200;
    let built = 0;

    for (let i = 0; i < LAYOUTS; i++) {
        const layout = quietly(() => buildDoomLayout(MAP_COLS, MAP_ROWS, { keyCount: 3 }));
        if (!layout) continue;
        built++;

        for (const zone of layout.zones) {
            const r = zone.rect;
            check(r.x >= 1 && r.y >= 1 && r.x + r.w <= MAP_COLS - 1 && r.y + r.h <= MAP_ROWS - 1,
                `layout ${i}: zone ${zone.id} rect ${JSON.stringify(r)} leaves the map`);
            check(r.w >= LAYOUT_CONFIG.MIN_ZONE_SPAN && r.h >= LAYOUT_CONFIG.MIN_ZONE_SPAN,
                `layout ${i}: zone ${zone.id} is smaller than the minimum span`);
        }

        // No two zones may overlap, or a tile would belong to both progressions.
        for (let a = 0; a < layout.zones.length; a++) {
            for (let b = a + 1; b < layout.zones.length; b++) {
                const p = layout.zones[a].rect;
                const q = layout.zones[b].rect;
                const overlaps = p.x < q.x + q.w && p.x + p.w > q.x &&
                                 p.y < q.y + q.h && p.y + p.h > q.y;
                check(!overlaps, `layout ${i}: zones ${a} and ${b} overlap`);
            }
        }
    }

    check(built === LAYOUTS, `only ${built} of ${LAYOUTS} layouts built`);
    console.log(`  ${built} layouts, rectangles in bounds and disjoint`);
}

// ------------------------------------------------------------------ zone looks

section('zone looks (150 layouts)');
{
    const LAYOUTS = 150;
    let built = 0;
    let transitions = 0;

    for (let i = 0; i < LAYOUTS; i++) {
        const baseStyle = i % WALL_STYLES.length;
        const layout = quietly(() => buildDoomLayout(MAP_COLS, MAP_ROWS, {
            keyCount: 3,
            styleCount: WALL_STYLES.length,
            baseStyle
        }));
        if (!layout) continue;
        built++;

        check(layout.zoneStyles[0] === baseStyle,
            `layout ${i}: start zone wears style ${layout.zoneStyles[0]}, asked for ${baseStyle}`);

        check(layout.tileStyles instanceof Uint8Array && layout.tileStyles.length === MAP_COLS * MAP_ROWS,
            `layout ${i}: tile style map is the wrong shape`);

        // Every gate must be a visible transition, or the contrast rule buys
        // nothing: the player would pass a locked door into somewhere identical.
        for (const zone of layout.zones) {
            if (zone.parent < 0) continue;
            transitions++;
            check(zone.styleIndex !== layout.zones[zone.parent].styleIndex,
                `layout ${i}: zone ${zone.id} wears its parent's look`);
        }

        // Every style index the map hands out must be one the renderer can draw.
        let outOfRange = 0;
        for (const index of layout.tileStyles) {
            if (index >= WALL_STYLES.length) outOfRange++;
        }
        check(outOfRange === 0, `layout ${i}: ${outOfRange} tiles name a style that does not exist`);

        // Inside a zone rectangle the look is the zone's, with no bleed. The rock
        // between zones is the only place the boundary is allowed to be fuzzy.
        let mismatched = 0;
        for (const zone of layout.zones) {
            for (let y = zone.rect.y; y < zone.rect.y + zone.rect.h; y++) {
                for (let x = zone.rect.x; x < zone.rect.x + zone.rect.w; x++) {
                    if (layout.tileStyles[y * MAP_COLS + x] !== zone.styleIndex) mismatched++;
                }
            }
        }
        check(mismatched === 0, `layout ${i}: ${mismatched} tiles inside a zone wear another zone's look`);
    }

    check(built === LAYOUTS, `only ${built} of ${LAYOUTS} layouts built`);
    console.log(`  ${built} layouts, ${transitions} gate transitions checked`);
}

section('terrain follows the zone it is in (40 levels)');
{
    let rooms = 0;
    let wrongTheme = 0;
    let zonesWithLiquid = 0;

    for (let level = 1; level <= 20; level++) {
        for (let repeat = 0; repeat < 2; repeat++) {
            globalThis.gameState = { currentLevel: level };
            const data = quietly(() => generateMaze(MAP_COLS, MAP_ROWS, false));
            if (!data?.tileStyles) continue;

            const seen = new Set();

            for (const room of data.rooms) {
                rooms++;
                const styleIndex = data.tileStyles[room.center.y * MAP_COLS + room.center.x];
                const weights = WALL_STYLES[styleIndex]?.terrain?.weights || {};

                for (let y = room.y; y < room.y + room.height; y++) {
                    for (let x = room.x; x < room.x + room.width; x++) {
                        const tile = data.gameMap[y][x];
                        if (!TERRAIN_TILES.includes(tile)) continue;
                        seen.add(`${room.zone}`);
                        // A theme that weights a liquid at zero must never grow it:
                        // lava in a flooded cistern would say the zone looks are
                        // decoration rather than something the level is built from.
                        if (!(weights[tile] > 0)) wrongTheme++;
                    }
                }
            }

            zonesWithLiquid += seen.size;
        }
    }

    check(wrongTheme === 0, `${wrongTheme} terrain tiles do not belong to their zone's theme`);
    check(zonesWithLiquid > 0, 'no zone grew any terrain at all');
    console.log(`  ${rooms} rooms checked, ${zonesWithLiquid} zone/level pairs grew liquid`);
}

// ------------------------------------------------------------------ end to end

section('generateMaze end to end (levels 1-12, 5 each)');
{
    let generated = 0;
    let narrow = 0;
    let corridor = 0;

    for (let level = 1; level <= 12; level++) {
        for (let repeat = 0; repeat < 5; repeat++) {
            globalThis.gameState = { currentLevel: level };

            const data = quietly(() => generateMaze(MAP_COLS, MAP_ROWS, false));
            generated++;

            check(!!data && !!data.gameMap, `level ${level}: no map produced`);
            if (!data?.gameMap) continue;

            check(validateMapConnectivity(data.gameMap, data.playerStart),
                `level ${level}: failed connectivity validation`);

            check(verifyProgression(data.gameMap, data.playerStart, MAP_COLS, MAP_ROWS),
                `level ${level}: progression does not verify after items and terrain`);

            check(findTiles(data.gameMap, TILE_EXIT).length === 1,
                `level ${level}: expected exactly one exit`);

            check(data.tileStyles instanceof Uint8Array,
                `level ${level}: no per-tile style map for the renderer`);

            // The player must not spawn inside a wall or standing in lava.
            const startTile = data.gameMap[data.playerStart.r][data.playerStart.c];
            check(startTile === TILE_EMPTY, `level ${level}: player starts on tile ${startTile}`);

            // Levels ramp from one key to the full three.
            const keysOnMap = KEY_TILES.filter(key => findTiles(data.gameMap, key).length > 0).length;
            const expected = level <= 1 ? 1 : (level <= 3 ? 2 : 3);
            check(keysOnMap === expected,
                `level ${level}: ${keysOnMap} keys on the map, expected ${expected}`);

            // Doors still come in pairs once secrets and terrain have been laid in.
            for (const door of DOOR_TILES) {
                const tiles = findTiles(data.gameMap, door);
                check(tiles.length === 0 || tiles.length === 2,
                    `level ${level}: door tile ${door} appears ${tiles.length} times`);
            }

            for (let y = 0; y < MAP_ROWS; y++) {
                for (let x = 0; x < MAP_COLS; x++) {
                    if (!isOpen(data.gameMap, x, y)) continue;
                    if (insideAnyRoom(data.rooms, x, y)) continue;
                    corridor++;
                    if (!inTwoWideBlock(data.gameMap, x, y)) narrow++;
                }
            }
        }
    }

    // Secret passages are deliberately one tile wide, and they are carved outside
    // the room list, so a small share of narrow non-room tiles is correct here.
    const narrowShare = narrow / Math.max(corridor, 1);
    check(narrowShare < 0.15,
        `${(narrowShare * 100).toFixed(1)}% of non-room tiles are narrow; secrets alone should not reach 15%`);

    console.log(`  ${generated} levels, ${(narrowShare * 100).toFixed(1)}% narrow non-room tiles (secrets)`);
}

// ------------------------------------------------------------------ boss levels

section('boss levels still generate');
{
    for (let repeat = 0; repeat < 10; repeat++) {
        globalThis.gameState = { currentLevel: 10 };
        const data = quietly(() => generateMaze(MAP_COLS, MAP_ROWS, true));

        check(!!data?.gameMap, 'boss level produced no map');
        if (!data?.gameMap) continue;

        check(!!data.bossSpawn, 'boss level has no boss spawn');
        check(validateMapConnectivity(data.gameMap, data.playerStart),
            'boss level failed connectivity validation');
        check(isSolvable(data.gameMap, data.playerStart, MAP_COLS, MAP_ROWS),
            'boss level exit is unreachable');

        // Boss levels are one arena and its approaches; no key hunt, and no zones
        // to theme -- the renderer should fall back to the level's own look.
        for (const door of DOOR_TILES) {
            check(findTiles(data.gameMap, door).length === 0, 'boss level has a locked door');
        }
        check(!data.tileStyles, 'boss level handed the renderer a zone style map');
    }
}

// ------------------------------------------------------------------ summary

console.log('');
if (failures === 0) {
    console.log(`level-layout: all ${checks} checks passed.`);
    process.exit(0);
} else {
    console.error(`level-layout: ${failures} of ${checks} checks FAILED.`);
    process.exit(1);
}
