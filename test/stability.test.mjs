// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Lighting must not flutter.  Run with: npm test
 *
 * The lit area has to change SMOOTHLY as the player moves and turns. It is easy to
 * get this wrong without noticing, because a still screenshot of a flickering scene
 * looks perfect: the fault only exists between frames.
 *
 * Both faults this guards against were real, and both came from the same place --
 * the shadow fan is sampled at a finite set of angles, and a ray's hit distance is
 * bimodal beside a corner, so it either catches the corner or slips past it.
 *
 *   - TURNING. The fan used to be measured from the beam's own direction, so every
 *     ray swept across the scene as the player turned and every corner in view
 *     flicked a shadow spike on and off. The fan is now cast on a fixed grid of
 *     angles: turning changes which rays are cast, never where they point.
 *
 *   - QUERYING. A point's occlusion used to be read off whichever single ray was
 *     nearest it, so the instant the light moved enough for that to become a
 *     different ray, the answer flipped the whole way. Points are now read from
 *     both rays either side and blended.
 *
 * The measure is the per-tile change in the light map between consecutive frames of
 * a slow movement. Real lighting change is gradual, so anything abrupt at this step
 * size is quantisation.
 */

import { TILE_SIZE, MAP_COLS, MAP_ROWS } from '../js/constants.js';
import { updateLighting, resetLighting, getLightMap } from '../js/lighting.js';

const failures = [];
const check = (name, condition, detail = '') => {
    if (condition) {
        console.log(`  ok    ${name}`);
    } else {
        console.log(`  FAIL  ${name}${detail ? ' -- ' + detail : ''}`);
        failures.push(name);
    }
};

/** A hall full of pillars: many corners, which is where flutter comes from. */
function pillarHall() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
    for (let r = 6; r <= 33; r++) for (let c = 6; c <= 43; c++) map[r][c] = 0;
    for (let r = 10; r <= 30; r += 5) for (let c = 10; c <= 40; c += 5) map[r][c] = 1;
    return map;
}

function snapshot() {
    const grid = getLightMap();
    const out = new Float32Array(MAP_COLS * MAP_ROWS);
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) out[r * MAP_COLS + c] = grid[r][c];
    }
    return out;
}

/**
 * Runs a motion and reports the largest jump any tile made in a single frame, and
 * how many tiles moved perceptibly per frame.
 */
function measure(steps, place) {
    const map = pillarHall();
    resetLighting();

    let previous = null, worst = 0, worstAt = '', jumpy = 0, frames = 0;
    for (let i = 0; i <= steps; i++) {
        updateLighting({ gameMap: map, player: place(i) });
        const now = snapshot();

        if (previous) {
            frames++;
            for (let n = 0; n < now.length; n++) {
                const delta = Math.abs(now[n] - previous[n]);
                if (delta > 0.02) jumpy++;
                if (delta > worst) {
                    worst = delta;
                    worstAt = `(${n % MAP_COLS},${Math.floor(n / MAP_COLS)})`;
                }
            }
        }
        previous = now;
    }
    return { worst, worstAt, perFrame: jumpy / frames };
}

console.log('\n=== stability ===\n');

// Open floor, clear of the pillars themselves
const cx = 22 * TILE_SIZE + TILE_SIZE / 2;
const cy = 22 * TILE_SIZE + TILE_SIZE / 2;

// --- 1. Turning on the spot ------------------------------------------------------
{
    // A quarter of a degree is far less than a frame of real mouse movement, so
    // nothing should visibly change between two of these at all.
    const fine = measure(120, (i) => ({ x: cx, y: cy, angle: i * 0.25 * Math.PI / 180 }));
    check(`turning a quarter degree moves no tile abruptly (worst ${fine.worst.toFixed(3)})`,
        fine.worst < 0.05, `at ${fine.worstAt}`);
    check(`...and almost none perceptibly (${fine.perFrame.toFixed(2)} tiles/frame)`,
        fine.perFrame < 0.5);

    // Sweeping a full circle at a realistic rate must stay just as smooth
    const swung = measure(180, (i) => ({ x: cx, y: cy, angle: i * 2 * Math.PI / 180 }));
    check(`turning two degrees stays smooth (worst ${swung.worst.toFixed(3)})`,
        swung.worst < 0.20, `at ${swung.worstAt}`);
}

// --- 2. Standing still -----------------------------------------------------------
{
    const still = measure(30, () => ({ x: cx, y: cy, angle: 0.7 }));
    check('standing still changes nothing at all', still.worst === 0,
        `worst ${still.worst.toFixed(4)} at ${still.worstAt}`);
}

// --- 3. Walking ------------------------------------------------------------------
{
    // Half a pixel is a twentieth of a frame of real walking. Some change is honest
    // -- the light really is somewhere else -- but it has to be gradual.
    const creep = measure(80, (i) => ({ x: cx + i * 0.5, y: cy, angle: 0 }));
    check(`creeping half a pixel stays gradual (worst ${creep.worst.toFixed(3)})`,
        creep.worst < 0.30, `at ${creep.worstAt}`);
}

// --- 4. The fan does not follow the aim ------------------------------------------
{
    // The property the turning fix rests on, asserted directly: two different
    // facings must sample the same set of ray directions, so a corner is always
    // measured by the same ray whichever way the player happens to be looking.
    const map = pillarHall();
    const { castLightPolygon, createPlayerLights } = await import('../js/lighting.js');

    const anglesFor = (aim) => {
        const cone = createPlayerLights({ x: cx, y: cy, angle: aim })
            .find(l => l.kind === 'cone');
        const polygon = castLightPolygon(cone, map);
        const out = [];
        for (let i = 0; i < polygon.distances.length; i++) {
            out.push(polygon.startAngle + i * polygon.angleStep);
        }
        return out;
    };

    const a = anglesFor(0.3);
    const b = anglesFor(0.3 + 0.004);          // a fraction of a ray step further round
    const step = Math.abs(a[1] - a[0]);

    // Every ray in the second fan must coincide with one in the first
    let offGrid = 0;
    for (const angle of b) {
        const k = (angle - a[0]) / step;
        if (Math.abs(k - Math.round(k)) > 1e-9) offGrid++;
    }
    check('rays sit on a fixed grid whatever the player faces', offGrid === 0,
        `${offGrid} of ${b.length} rays moved off the grid`);
}

console.log('');
if (failures.length === 0) {
    console.log('All stability checks passed.');
} else {
    console.log(`${failures.length} stability FAILURE(S):`);
    failures.forEach(f => console.log('  - ' + f));
}
process.exit(failures.length === 0 ? 0 : 1);
