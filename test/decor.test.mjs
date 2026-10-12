// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Room decoration checks. Run with: npm test
 *
 * Props are wall tiles, so the one thing that can go wrong is a room that
 * furnishes itself shut. Every kind is driven over a synthetic level and the
 * reachability rule, the doorway and item margins and the solid budget are
 * checked, then generated levels are checked for still verifying furnished.
 */

import {
    TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL, TILE_PROP, TILE_KEY_RED, TILE_DOOR_RED, WALL_STYLES,
} from '../js/constants.js';
import { isPathClear, checkWallCollision, isSolidAt, blocksSightAt } from '../js/utils.js';
import { updateLighting, resetLighting, getTileLight } from '../js/lighting.js';
import {
    DECOR, SOLID_FROM, isSolidDecor, decorateRooms, collectDecorLights, ROOM_KINDS, ROOM_KINDS_BY_STYLE,
    DECOR_CONFIG, DECOR_LIGHTS,
} from '../js/decor.js';

let failures = 0;
function check(label, condition, detail = '') {
    if (condition) {
        console.log(`  ok    ${label}`);
    } else {
        failures++;
        console.error(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
    }
}

console.log('\n=== decor ===\n');

/** Three rooms joined by two-wide corridors, one with a key and a locked door. */
function level() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_WALL));
    const rooms = [
        { x: 4, y: 20, width: 6, height: 5, id: 0, role: 'start', center: { x: 7, y: 22 } },
        { x: 18, y: 14, width: 12, height: 10, id: 1, role: 'transit', center: { x: 24, y: 19 } },
        { x: 40, y: 16, width: 9, height: 9, id: 2, role: 'key-red', center: { x: 44, y: 20 } },
    ];
    for (const r of rooms) {
        for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) map[y][x] = TILE_EMPTY;
    }
    for (let x = 10; x < 18; x++) { map[21][x] = TILE_EMPTY; map[22][x] = TILE_EMPTY; }
    for (let x = 30; x < 40; x++) { map[19][x] = TILE_EMPTY; map[20][x] = TILE_EMPTY; }
    map[19][34] = TILE_DOOR_RED; map[20][34] = TILE_DOOR_RED;
    map[18][46] = TILE_KEY_RED;
    return { map, rooms, start: { c: 7, r: 22 } };
}

function reachable(map, start) {
    const seen = new Set();
    const stack = [[start.c, start.r]];
    while (stack.length) {
        const [c, r] = stack.pop();
        if (c < 0 || c >= MAP_COLS || r < 0 || r >= MAP_ROWS) continue;
        const code = r * MAP_COLS + c;
        if (seen.has(code)) continue;
        if (map[r][c] === TILE_WALL || map[r][c] === TILE_PROP) continue;
        seen.add(code);
        stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    return seen;
}

function floorCount(map) {
    let n = 0;
    for (const row of map) for (const t of row) if (t !== TILE_WALL && t !== TILE_PROP) n++;
    return n;
}

const styleNamed = (name) => WALL_STYLES.find(s => s.name === name);

console.log('[every kind]');
for (const kind of ROOM_KINDS) {
    // Force this kind by giving the look a weights table of one entry.
    const style = { ...WALL_STYLES[0], name: `only-${kind}` };
    ROOM_KINDS_BY_STYLE[style.name] = { [kind]: 1 };

    const { map, rooms, start } = level();
    const before = reachable(map, start).size;
    const floorBefore = floorCount(map);

    const { decor, lights } = decorateRooms(map, rooms, {
        playerStart: start, playerStartRoom: rooms[0], styleForRoom: () => style,
    });

    const after = reachable(map, start).size;
    const solids = floorBefore - floorCount(map);
    const solidTiles = [];
    for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) {
        if (isSolidDecor(decor[r * MAP_COLS + c])) solidTiles.push([c, r]);
    }

    check(`${kind}: nothing reachable is cut off`, after === before - solids, `${before} -> ${after}, ${solids} solids`);
    check(`${kind}: every prop is a prop tile inside a room`, solidTiles.every(([c, r]) =>
        map[r][c] === TILE_PROP && rooms.some(rm => c >= rm.x && c < rm.x + rm.width && r >= rm.y && r < rm.y + rm.height)));
    check(`${kind}: the start room stays plain`, solidTiles.every(([c, r]) =>
        !(c >= rooms[0].x && c < rooms[0].x + rooms[0].width && r >= rooms[0].y && r < rooms[0].y + rooms[0].height)));

    // Doorway margins: the corridor mouths at (18,21..22) and (30,19..20)/(40,19..20)
    const mouths = [[18, 21], [18, 22], [29, 19], [29, 20], [40, 19], [40, 20]];
    const nearMouth = solidTiles.some(([c, r]) => mouths.some(([mc, mr]) => Math.abs(mc - c) <= 1 && Math.abs(mr - r) <= 1));
    check(`${kind}: nothing stands at a doorway`, !nearMouth);
    const nearKey = solidTiles.some(([c, r]) => Math.abs(46 - c) <= 1 && Math.abs(18 - r) <= 1);
    check(`${kind}: nothing boxes the key in`, !nearKey && map[18][46] === TILE_KEY_RED);

    for (const room of rooms.slice(1)) {
        const inRoom = solidTiles.filter(([c, r]) => c >= room.x && c < room.x + room.width && r >= room.y && r < room.y + room.height).length;
        check(`${kind}: room ${room.id} keeps most of its floor`, inRoom <= room.width * room.height * DECOR_CONFIG.MAX_SOLID_FRACTION + 1e-9,
            `${inRoom} of ${room.width * room.height}`);
    }

    const glowing = [];
    for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) if (DECOR_LIGHTS[decor[r * MAP_COLS + c]]) glowing.push(1);
    check(`${kind}: every glowing decoration is a light`, lights.length === glowing.length, `${lights.length} vs ${glowing.length}`);
    delete ROOM_KINDS_BY_STYLE[style.name];
}

console.log('[a prop is not a wall]');
{
    globalThis.window = globalThis;
    const { map, start } = level();
    // A pillar between the player and the room's north wall (row 13)
    map[18][24] = TILE_PROP;
    const from = { x: 24 * TILE_SIZE + 20, y: 21 * TILE_SIZE + 20 };
    const to = { x: 24 * TILE_SIZE + 20, y: 15 * TILE_SIZE + 20 };
    check('a prop blocks movement', isSolidAt(map, 24, 18) && checkWallCollision(24 * TILE_SIZE + 20, 18 * TILE_SIZE + 20, 10, map));
    check('...but not sight', !blocksSightAt(map, 24, 18) && isPathClear(from.x, from.y, to.x, to.y, map));

    resetLighting();
    updateLighting({ gameMap: map, player: { x: from.x, y: from.y, angle: -Math.PI / 2 } });
    check('...nor light: the floor beyond it is lit', getTileLight(24, 15) > 0, `${getTileLight(24, 15)}`);
    check('...and the prop tile itself is lit like floor', getTileLight(24, 18) > 0);
    check('...and the wall behind it is lit', map[13][24] === TILE_WALL && getTileLight(24, 13) > 0, `${getTileLight(24, 13)}`);
    delete globalThis.window;
}

console.log('[placement]');
{
    // Furnishing has to read as a place. These drive each kind over the
    // synthetic level and check the layout rules the recipes are built on:
    // things against the wall they belong to, rows that are rows, symmetry
    // where a builder would have used it, detail where it would fall.
    const decorate = (kind) => {
        const style = { ...WALL_STYLES[0], name: `only-${kind}` };
        ROOM_KINDS_BY_STYLE[style.name] = { [kind]: 1 };
        const { map, rooms, start } = level();
        const { decor } = decorateRooms(map, rooms, { playerStart: start, playerStartRoom: rooms[0], styleForRoom: () => style });
        delete ROOM_KINDS_BY_STYLE[style.name];
        const room = rooms[1];                       // 12 x 10, entered from west and east
        const tilesOf = (id) => {
            const out = [];
            for (let r = room.y; r < room.y + room.height; r++) for (let c = room.x; c < room.x + room.width; c++) {
                if (decor[r * MAP_COLS + c] === id) out.push([c, r]);
            }
            return out;
        };
        const x1 = room.x + room.width - 1, y1 = room.y + room.height - 1;
        const onEdge = ([c, r]) => c === room.x || c === x1 || r === room.y || r === y1;
        const onQuietEdge = ([c, r]) => r === room.y || r === y1;   // west and east have the doorways
        const isCorner = ([c, r]) => (c === room.x || c === x1) && (r === room.y || r === y1);
        const has = (id, [c, r]) => decor[r * MAP_COLS + c] === id;
        return { map, decor, room, tilesOf, onEdge, onQuietEdge, isCorner, has, x1, y1 };
    };

    {
        const L = decorate('cargo');
        const stripes = L.tilesOf(DECOR.STRIPES);
        const crates = [...L.tilesOf(DECOR.CRATE), ...L.tilesOf(DECOR.CRATES)];
        check('cargo: the loading edge is striped along one wall', stripes.length >= 6 && new Set(stripes.map(t => t[1])).size === 1);
        const backRow = stripes[0][1] === L.room.y + 1 ? L.room.y : L.y1;
        check('cargo: crates stand against the back wall', crates.length >= 4 && crates.every(([, r]) => Math.abs(r - backRow) <= 1));
        // The south-west corner is beside the west doorway, so that pallet
        // slides along the wall; the other stands in its corner.
        check('cargo: pallets are stacked in the back corners, or as near as the door allows',
            L.tilesOf(DECOR.CRATES).length >= 8 && L.tilesOf(DECOR.CRATES).every(([, r]) => Math.abs(r - backRow) <= 1) &&
            (L.tilesOf(DECOR.CRATES).some(t => t[0] === L.room.x) || L.tilesOf(DECOR.CRATES).some(t => t[0] === L.x1)));
        check('cargo: an aisle of plate leads in from the doorway', L.tilesOf(DECOR.PLATE).length >= 3 && new Set(L.tilesOf(DECOR.PLATE).map(t => t[0])).size === 1);
        check('cargo: lamps hang on a grid', L.tilesOf(DECOR.LAMP).length >= 2);
    }
    {
        const L = decorate('lab');
        const consoles = L.tilesOf(DECOR.CONSOLE);
        const benches = L.tilesOf(DECOR.BENCH);
        check('lab: the console bank lines the back wall', consoles.length >= 4 && consoles.every(L.onQuietEdge) && new Set(consoles.map(t => t[1])).size === 1);
        check('lab: vats stand in the corners beside it', L.tilesOf(DECOR.VAT).length >= 1 && L.tilesOf(DECOR.VAT).every(L.isCorner));
        check('lab: benches run in rows', benches.length >= 4 && benches.every(([c, r]) => L.has(DECOR.BENCH, [c - 1, r]) || L.has(DECOR.BENCH, [c + 1, r])));
        check('lab: there is an aisle between the rows', new Set(benches.map(t => t[1])).size >= 2 &&
            [...new Set(benches.map(t => t[1]))].sort((a, b) => a - b).every((r, i, rows) => i === 0 || r - rows[i - 1] >= 2));
    }
    {
        const L = decorate('barracks');
        const lockers = L.tilesOf(DECOR.LOCKER);
        check('barracks: lockers line the side walls', lockers.length >= 6 && lockers.every(L.onQuietEdge));
        check('barracks: on both sides', new Set(lockers.map(t => t[1])).size === 2);
    }
    {
        const L = decorate('storage');
        const racks = L.tilesOf(DECOR.RACK);
        const rows = [...new Set(racks.map(t => t[1]))];
        check('storage: shelving runs in rows', racks.length >= 6 && racks.every(([c, r]) => L.has(DECOR.RACK, [c - 1, r]) || L.has(DECOR.RACK, [c + 1, r])));
        check('storage: with aisles you can fight in', rows.length >= 2 && rows.sort((a, b) => a - b).every((r, i) => i === 0 || r - rows[i - 1] >= 3));
    }
    {
        const L = decorate('hall');
        const pillars = L.tilesOf(DECOR.PILLAR);
        check('hall: a colonnade down both sides', pillars.length >= 6 && new Set(pillars.map(t => t[1])).size === 2);
        // Mirrored, except where a doorway's margin takes a column away
        const mirrored = pillars.filter(([c, r]) => L.has(DECOR.PILLAR, [c, L.room.y + L.y1 - r])).length;
        check('hall: mirrored across the axis', mirrored >= pillars.length * 0.6, `${mirrored} of ${pillars.length}`);
        const mosaic = L.tilesOf(DECOR.MOSAIC);
        check('hall: a mosaic aisle down the centre', mosaic.length >= 8 && new Set(mosaic.map(t => t[1])).size === 1 &&
            mosaic[0][1] === L.room.y + Math.floor(L.room.height / 2));
        check('hall: braziers flank the doorways', L.tilesOf(DECOR.BRAZIER).length >= 3 && L.tilesOf(DECOR.BRAZIER).every(([c]) => c === L.room.x + 1 || c === L.x1 - 1));
    }
    {
        const L = decorate('crypt');
        const tombs = L.tilesOf(DECOR.SARCOPHAGUS);
        check('crypt: braziers burn in the corners', L.tilesOf(DECOR.BRAZIER).length >= 2 && L.tilesOf(DECOR.BRAZIER).every(L.isCorner));
        check('crypt: sarcophagi come in pairs', tombs.length >= 4 && tombs.every(([c, r]) => L.has(DECOR.SARCOPHAGUS, [c - 1, r]) || L.has(DECOR.SARCOPHAGUS, [c + 1, r])));
        check('crypt: in two ranks', new Set(tombs.map(t => t[1])).size === 2);
    }
    {
        const L = decorate('forge');
        const furnaces = L.tilesOf(DECOR.FURNACE);
        const slag = L.tilesOf(DECOR.SLAG);
        check('forge: furnaces are banked on the back wall', furnaces.length >= 2 && furnaces.every(L.onQuietEdge) && new Set(furnaces.map(t => t[1])).size === 1);
        check('forge: slag cools in front of them', slag.length >= 2 && slag.every(([c, r]) => furnaces.some(([fc, fr]) => Math.abs(fc - c) <= 1 && Math.abs(fr - r) <= 2)));
    }
    {
        const L = decorate('plant');
        const machines = L.tilesOf(DECOR.MACHINE);
        const cables = L.tilesOf(DECOR.CABLE);
        check('plant: machinery is banked on the back wall', machines.length >= 2 && machines.every(L.onQuietEdge) && new Set(machines.map(t => t[1])).size === 1);
        check('plant: every cable runs straight out from a machine', cables.length >= 2 && cables.every(([c]) => machines.some(([mc]) => mc === c)));
        check('plant: tanks stand in the back corners', L.tilesOf(DECOR.TANK).every(L.isCorner));
    }
    {
        const L = decorate('cistern');
        const pillars = L.tilesOf(DECOR.PILLAR);
        // On a grid: every pillar has a partner in its row and its column,
        // except where a doorway's margin took one away.
        const gridded = pillars.filter(([c, r]) => pillars.some(([oc, or]) => oc === c && or !== r) && pillars.some(([oc, or]) => or === r && oc !== c)).length;
        check('cistern: pillars stand on a grid', pillars.length >= 6 && gridded >= pillars.length * 0.75, `${gridded} of ${pillars.length}`);
        const grates = L.tilesOf(DECOR.GRATE);
        check('cistern: a channel of grates runs down the middle', grates.length >= 6 && new Set(grates.map(t => t[1])).size === 1);
    }
}

console.log('[ids]');
{
    const ids = Object.values(DECOR).filter(v => v > 0);
    check('ids are unique', new Set(ids).size === ids.length);
    check('solid ids start at SOLID_FROM', ids.filter(isSolidDecor).every(v => v >= SOLID_FROM) && ids.filter(v => !isSolidDecor(v)).every(v => v < SOLID_FROM));
    check('every look has room kinds', WALL_STYLES.every(s => ROOM_KINDS_BY_STYLE[s.name]));
    check('every named kind has a recipe', WALL_STYLES.every(s => Object.keys(ROOM_KINDS_BY_STYLE[s.name]).every(k => ROOM_KINDS.includes(k))));
}

console.log('[lights at runtime]');
{
    const many = [];
    for (let i = 0; i < 30; i++) many.push({ id: DECOR.LAMP, x: 100 + i * 30, y: 100, ...DECOR_LIGHTS[DECOR.LAMP] });
    const lit = collectDecorLights(many, { x: 100, y: 100 }, 0);
    check('the budget holds', lit.length === DECOR_CONFIG.LIGHT_MAX);
    check('the nearest burn', lit.every(l => l.x <= 100 + (DECOR_CONFIG.LIGHT_MAX - 1) * 30));
    check('they are gated by sight', lit.every(l => l.gated === true));
    const far = collectDecorLights(many, { x: 5000, y: 5000 }, 0);
    check('distant lights are not cast', far.length === 0);
    const furnace = [{ id: DECOR.FURNACE, x: 0, y: 0, ...DECOR_LIGHTS[DECOR.FURNACE] }];
    const a = collectDecorLights(furnace, { x: 0, y: 0 }, 0)[0].intensity;
    const b = collectDecorLights(furnace, { x: 0, y: 0 }, 130)[0].intensity;
    check('a furnace flickers', a !== b);
    const lamp = collectDecorLights(many.slice(0, 1), { x: 100, y: 100 }, 0)[0];
    check('a lamp burns steady', lamp.intensity === DECOR_LIGHTS[DECOR.LAMP].intensity);
}

console.log('[generated levels]');
{
    const noop = () => {};
    globalThis.window = globalThis;
    globalThis.gameState = { currentLevel: 4, selectedDifficulty: 'medium', player: null };
    const { generateMaze } = await import('../js/map-generator.js');
    const { verifyProgression } = await import('../js/level-layout.js');
    const origLog = console.log;
    let levels = 0, furnished = 0, verified = 0, lit = 0, kinds = new Set();
    for (let i = 0; i < 5; i++) {
        console.log = noop;
        const data = generateMaze(MAP_COLS, MAP_ROWS, false);
        console.log = origLog;
        if (!data.decor) continue;
        levels++;
        let solids = 0;
        for (let k = 0; k < data.decor.length; k++) if (isSolidDecor(data.decor[k])) solids++;
        if (solids > 0) furnished++;
        if (data.decorLights.length > 0) lit++;
        if (verifyProgression(data.gameMap, data.playerStart, MAP_COLS, MAP_ROWS)) verified++;
        for (const kind of Object.values(data.roomKinds)) kinds.add(kind);
    }
    check('generated levels are furnished', levels > 0 && furnished === levels, `${furnished} of ${levels}`);
    check('...and lit by their furniture', lit === levels);
    check('...and still verify', verified === levels);
    check('a level uses more than one room kind', kinds.size >= 2, [...kinds].join(', '));
    delete globalThis.gameState;
}

console.log('');
if (failures === 0) {
    console.log('All decor checks passed.');
} else {
    console.log(`${failures} decor check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
