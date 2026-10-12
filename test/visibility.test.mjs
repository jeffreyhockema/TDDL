// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Property test: the wall-face rule, checked against a naive ray march.  Run with: npm test
 *
 * A wall block is lit through the side that fronts walkable ground -- the ground the
 * player could stand on to look at it -- and only if the source can see that ground.
 * litWallFace() in js/lighting.js decides that using the shadow polygon: a DDA grid
 * walk per ray, and an index lookup to find the ray pointing at a given spot.
 *
 * That machinery is fast and easy to be subtly wrong in. So this generates real
 * levels, stands the player all over them, and for every wall block within the glow
 * compares two answers:
 *
 *   - the shipped rule -- litWallFace()
 *   - a reference -- step finely along a straight line from each of the lamp's
 *     origins to the point in front of each face, and see whether anything solid is
 *     in the way
 *
 * Both directions are failures. A block the reference can see but the rule leaves
 * dark is a hole -- that is how the 45-degree tie-break bug was found, where a wall
 * diagonally past a corner sat exactly on a ray the grid walk had to round and the
 * whole tile went black. A block the reference CANNOT see but the rule lights is
 * light passing through rock, which is what the face rule exists to prevent: it is
 * the far side of a wall between two rooms, or the shaded side of a spur.
 *
 * Which faces a block has is mirrored from litWallFace() rather than rederived --
 * that part is the specification. The visibility maths is independent, and is the
 * part actually under test.
 */

import { TILE_SIZE, MAP_COLS, MAP_ROWS } from '../js/constants.js';
import { LIGHTING, castLightPolygon, createPlayerLights, isOpaqueTile, litWallFace }
    from '../js/lighting.js';
import { generateMaze } from '../js/map-generator.js';

const failures = [];
const check = (name, condition, detail = '') => {
    if (condition) {
        console.log(`  ok    ${name}`);
    } else {
        console.log(`  FAIL  ${name}${detail ? ' -- ' + detail : ''}`);
        failures.push(name);
    }
};

const ORTHOGONAL = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const DIAGONAL = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

function isWalkable(map, c, r) {
    if (c < 0 || c >= MAP_COLS || r < 0 || r >= MAP_ROWS) return false;
    return !isOpaqueTile(map[r][c]);
}

/**
 * The faces a wall block has, mirrored from litWallFace(): the sides fronting
 * walkable ground, or -- only when it has none -- the corners it fronts it at.
 */
function facesOf(map, c, r) {
    const faces = ORTHOGONAL.filter(([fx, fy]) => isWalkable(map, c + fx, r + fy));
    if (faces.length) return faces;
    return DIAGONAL.filter(([fx, fy]) => isWalkable(map, c + fx, r + fy));
}

/** Where a face is measured, mirrored from wallFaceSamplePoint(). */
function facePoint(c, r, fx, fy) {
    const reach = TILE_SIZE / 2 + LIGHTING.WALL_FACE_SAMPLE_PX;
    return [c * TILE_SIZE + TILE_SIZE / 2 + fx * reach,
            r * TILE_SIZE + TILE_SIZE / 2 + fy * reach];
}

/** The positions a light is cast from, mirrored from lightOrigins(). */
function originsOf(light) {
    const radius = light.originRadius ?? LIGHTING.LIGHT_RADIUS;
    const count = light.originCount ?? LIGHTING.LIGHT_ORIGINS;
    const origins = [[light.x, light.y]];
    if (!(radius > 0) || count < 2) return origins;
    for (let i = 0; i < count - 1; i++) {
        const angle = (i / (count - 1)) * Math.PI * 2;
        origins.push([light.x + Math.cos(angle) * radius,
                      light.y + Math.sin(angle) * radius]);
    }
    return origins;
}

/**
 * Independent reference: walk a straight line in fine steps and report how far it
 * gets before something solid stops it.
 *
 * Sight passes a SINGLE corner -- standing beside a wall you can see the tile
 * diagonally past it -- but not between two blocks meeting corner to corner, which
 * would be seeing through rock.
 */
function reachDistance(map, ox, oy, tx, ty) {
    const dx = tx - ox, dy = ty - oy;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return 0;

    const steps = Math.ceil(distance / (TILE_SIZE / 64));
    let prevC = Math.floor(ox / TILE_SIZE), prevR = Math.floor(oy / TILE_SIZE);

    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const c = Math.floor((ox + dx * t) / TILE_SIZE);
        const r = Math.floor((oy + dy * t) / TILE_SIZE);
        if (c < 0 || c >= MAP_COLS || r < 0 || r >= MAP_ROWS) return distance * t;

        if (c !== prevC && r !== prevR &&
            isOpaqueTile(map[prevR][c]) && isOpaqueTile(map[r][prevC])) {
            return distance * t;                 // squeezed between two corners
        }
        if (isOpaqueTile(map[r][c])) return distance * t;
        prevC = c; prevR = r;
    }
    return distance;
}

/**
 * Can any part of the lamp PLAINLY see the ground in front of any of this block's
 * faces?
 *
 * Plainly, meaning with room to spare: the line is checked at the face point and a
 * pixel and a half to either side of it, and all three must get through. Without
 * that the reference asserts on rays threading an exact wall corner, where it and
 * the grid walk legitimately disagree -- one squeezes past the corner point, the
 * other lands on it and stops -- and neither answer is more right than the other.
 * Those are a measure-zero case and not what this test is for.
 */
function faceIsVisible(map, light, c, r, maxRange) {
    // The same slack litWallFace() allows, so the two are asked the same question.
    // Without it the reference calls a face hidden that the rule, deliberately
    // tolerant at shadow edges to stop walls flickering, still lights.
    const tolerance = TILE_SIZE * 0.15;
    const clearance = 1.5;

    for (const [fx, fy] of facesOf(map, c, r)) {
        const [px, py] = facePoint(c, r, fx, fy);
        for (const [ox, oy] of originsOf(light)) {
            const wanted = Math.hypot(px - ox, py - oy);
            if (wanted > maxRange || wanted === 0) continue;

            // Perpendicular to the line, so the offsets straddle it
            const nx = -(py - oy) / wanted * clearance;
            const ny = (px - ox) / wanted * clearance;

            let clear = true;
            for (const [jx, jy] of [[0, 0], [nx, ny], [-nx, -ny]]) {
                const tx = px + jx, ty = py + jy;
                const want = Math.hypot(tx - ox, ty - oy);
                if (reachDistance(map, ox, oy, tx, ty) < want - tolerance) {
                    clear = false;
                    break;
                }
            }
            if (clear) return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------- scan
console.log('\n=== visibility ===\n');

const origLog = console.log;
console.log = () => {}; console.warn = () => {};
globalThis.window = globalThis;
globalThis.gameState = { currentLevel: 1 };

let seen = 0, hidden = 0, missed = 0, phantom = 0;
const holes = [], leaks = [];

for (let level = 0; level < 12; level++) {
    const map = generateMaze(MAP_COLS, MAP_ROWS, false).gameMap;

    for (let attempt = 0; attempt < 200; attempt++) {
        const pc = 2 + ((attempt * 17 + level * 7) % (MAP_COLS - 4));
        const pr = 2 + ((attempt * 11 + level * 5) % (MAP_ROWS - 4));
        if (map[pr][pc] !== 0) continue;

        const player = {
            x: pc * TILE_SIZE + TILE_SIZE / 2,
            y: pr * TILE_SIZE + TILE_SIZE / 2,
            angle: 0,
        };
        // The glow: a point source, so nothing here is confused by beam shape
        const glow = createPlayerLights(player).find(l => l.kind === 'point');
        const polygon = castLightPolygon(glow, map);

        const reach = Math.ceil(glow.range / TILE_SIZE) + 1;
        for (let r = pr - reach; r <= pr + reach; r++) {
            for (let c = pc - reach; c <= pc + reach; c++) {
                if (r < 0 || r >= MAP_ROWS || c < 0 || c >= MAP_COLS) continue;
                if (!isOpaqueTile(map[r][c])) continue;

                const lit = !!litWallFace(polygon, map, c, r);

                // Two ranges, because the two directions are asking different
                // things. A block is only REQUIRED to be lit while it is inside the
                // reach where the lamp still delivers something: the falloff runs to
                // zero at the range limit, so a face the lamp can geometrically see
                // out there receives nothing, and that is the falloff working, not a
                // hole. Nothing beyond the full range may be lit at all.
                if (faceIsVisible(map, glow, c, r, glow.range * 0.9)) {
                    seen++;
                    if (!lit) {
                        missed++;
                        if (holes.length < 3) holes.push(`player(${pc},${pr}) wall(${c},${r})`);
                    }
                } else if (!faceIsVisible(map, glow, c, r, glow.range)) {
                    hidden++;
                    if (lit) {
                        phantom++;
                        if (leaks.length < 3) leaks.push(`player(${pc},${pr}) wall(${c},${r})`);
                    }
                }
            }
        }
    }
}

console.log = origLog;

check('the scan exercised real geometry on both sides', seen > 1000 && hidden > 1000,
    `${seen} visible and ${hidden} hidden wall blocks examined`);
check('every wall block the lamp can see is lit', missed === 0,
    `${missed} of ${seen} left dark${holes.length ? ' -- e.g. ' + holes[0] : ''}`);
check('no wall block the lamp cannot see is lit', phantom === 0,
    `${phantom} of ${hidden} lit${leaks.length ? ' -- e.g. ' + leaks[0] : ''}`);

console.log('');
if (failures.length === 0) {
    console.log('All visibility checks passed.');
} else {
    console.log(`${failures.length} visibility FAILURE(S):`);
    failures.forEach(f => console.log('  - ' + f));
}
process.exit(failures.length === 0 ? 0 : 1);
