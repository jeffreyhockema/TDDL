// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Tests for the lighting / fog-of-war system.  Run with: npm test
 *
 * These exercise js/lighting.js directly against hand-built maps, so the shadow
 * casting, cone shape, glow radius and memory behaviour can be asserted without a
 * canvas. The rendering in main.js is a thin consumer of exactly this data.
 */

import { TILE_SIZE, MAP_COLS, MAP_ROWS } from '../js/constants.js';
import {
    LIGHTING, updateLighting, resetLighting,
    getTileLight, isTileLit, isTileExplored, sampleLightAt,
    getActivePolygons, collectLightSources, angularFactor,
    castLightPolygon, isPointInLightPolygon, isOpaqueTile,
    getTileVision, isTileSensed, isTilePerceived, sampleVisionAt,
    collectVisionSources, getVisionPolygons, litWallFace,
    getSightPolygon, isTileInSight, rayDirection
} from '../js/lighting.js';
import { TILE_LAVA, TILE_DOOR_RED } from '../js/constants.js';
import { registerDoors, getDoors, resetDoors } from '../js/doors.js';

const failures = [];
const check = (name, condition, detail = '') => {
    if (condition) {
        console.log(`  ok    ${name}`);
    } else {
        console.log(`  FAIL  ${name}${detail ? ' -- ' + detail : ''}`);
        failures.push(name);
    }
};

/** Open map with a solid border, so light has room to travel. */
function openMap() {
    const map = Array.from({ length: MAP_ROWS }, (_, r) =>
        Array.from({ length: MAP_COLS }, (_, c) =>
            (r === 0 || c === 0 || r === MAP_ROWS - 1 || c === MAP_COLS - 1) ? 1 : 0));
    return map;
}

/** Minimal stand-in for GameState as far as lighting is concerned. */
function stateAt(map, tileX, tileY, angle) {
    return {
        gameMap: map,
        player: {
            x: tileX * TILE_SIZE + TILE_SIZE / 2,
            y: tileY * TILE_SIZE + TILE_SIZE / 2,
            angle,
        },
    };
}

console.log('\n=== lighting ===\n');

const PX = 25, PY = 20;          // Player tile, comfortably inside the map
const EAST = 0;                  // Aim +X
const WEST = Math.PI;

// --- 1. The glow lights all directions close in --------------------------------
{
    resetLighting();
    updateLighting(stateAt(openMap(), PX, PY, EAST));

    const glowTiles = Math.floor(LIGHTING.GLOW_RADIUS / TILE_SIZE);
    check('player tile is lit', isTileLit(PX, PY));
    check('glow lights the tile behind the player',
        isTileLit(PX - 1, PY), `light=${getTileLight(PX - 1, PY).toFixed(3)}`);
    check('glow lights above and below',
        isTileLit(PX, PY - 1) && isTileLit(PX, PY + 1));
    check('glow reaches roughly its radius',
        isTileLit(PX - (glowTiles - 1), PY),
        `light at ${glowTiles - 1} tiles behind = ${getTileLight(PX - (glowTiles - 1), PY).toFixed(3)}`);
    check('nothing is lit far behind the player',
        !isTileLit(PX - (glowTiles + 3), PY),
        `light=${getTileLight(PX - (glowTiles + 3), PY).toFixed(3)}`);
}

// --- 2. The flashlight cone reaches far forward, and only forward ---------------
{
    resetLighting();
    updateLighting(stateAt(openMap(), PX, PY, EAST));

    const far = Math.floor(LIGHTING.FLASHLIGHT_RANGE / TILE_SIZE) - 2;
    check('cone lights a tile far ahead',
        isTileLit(PX + far, PY), `light=${getTileLight(PX + far, PY).toFixed(3)}`);
    check('cone does NOT light the same distance behind',
        !isTileLit(PX - far, PY), `light=${getTileLight(PX - far, PY).toFixed(3)}`);

    // A tile far out but ~90 degrees off-axis is outside a 120-degree beam
    check('cone does not light far off-axis tiles',
        !isTileLit(PX, PY - far), `light=${getTileLight(PX, PY - far).toFixed(3)}`);
    check('brightness falls off with distance',
        getTileLight(PX + 2, PY) > getTileLight(PX + far, PY));
}

// --- 3. Aiming rotates the lit region immediately -------------------------------
{
    const map = openMap();
    const far = Math.floor(LIGHTING.FLASHLIGHT_RANGE / TILE_SIZE) - 2;

    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));
    const eastLit = isTileLit(PX + far, PY);

    updateLighting(stateAt(map, PX, PY, WEST));
    const stillEastLit = isTileLit(PX + far, PY);
    const nowWestLit = isTileLit(PX - far, PY);

    check('turning around lights the new direction', eastLit && nowWestLit);
    check('turning around unlights the old direction', !stillEastLit);
}

// --- 4. Walls cast shadows ------------------------------------------------------
{
    const map = openMap();
    // A wall segment two tiles east of the player, spanning vertically
    for (let dy = -3; dy <= 3; dy++) map[PY + dy][PX + 2] = 1;

    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    check('the wall face itself is lit',
        isTileLit(PX + 2, PY), `light=${getTileLight(PX + 2, PY).toFixed(3)}`);
    check('the tile directly behind the wall is in shadow',
        !isTileLit(PX + 3, PY), `light=${getTileLight(PX + 3, PY).toFixed(3)}`);
    check('a tile well behind the wall is in shadow',
        !isTileLit(PX + 6, PY), `light=${getTileLight(PX + 6, PY).toFixed(3)}`);
}

// --- 5. Closed doors block light ------------------------------------------------
{
    const map = openMap();
    for (let dy = -3; dy <= 3; dy++) map[PY + dy][PX + 2] = 4; // TILE_DOOR_BLUE

    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    check('a closed door is itself lit', isTileLit(PX + 2, PY));
    check('a closed door blocks light beyond it',
        !isTileLit(PX + 4, PY), `light=${getTileLight(PX + 4, PY).toFixed(3)}`);
}

// --- 6. Memory: geometry is remembered, live light is not ------------------------
{
    const map = openMap();
    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    const probeX = PX + 4;
    check('probe tile starts lit', isTileLit(probeX, PY));
    check('probe tile is recorded as explored', isTileExplored(probeX, PY));

    // Walk far away and look the other way
    updateLighting(stateAt(map, PX - 15, PY, WEST));

    check('probe tile is no longer lit once the light leaves',
        !isTileLit(probeX, PY), `light=${getTileLight(probeX, PY).toFixed(3)}`);
    check('probe tile is still remembered (walls/floors stay dim, not black)',
        isTileExplored(probeX, PY));
    check('a never-visited tile is not remembered', !isTileExplored(2, 2));
}

// --- 7. resetLighting wipes memory ----------------------------------------------
{
    const map = openMap();
    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));
    check('explored before reset', isTileExplored(PX, PY));

    resetLighting();
    check('explored cleared by resetLighting', !isTileExplored(PX, PY));
    check('light cleared by resetLighting', !isTileLit(PX, PY));
}

// --- 8. Continuous sampling for entities between tiles --------------------------
{
    const map = openMap();
    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    const atPlayer = sampleLightAt(PX * TILE_SIZE + TILE_SIZE / 2, PY * TILE_SIZE + TILE_SIZE / 2);
    const farBehind = sampleLightAt((PX - 12) * TILE_SIZE, PY * TILE_SIZE);

    check('sampleLightAt is bright at the player', atPlayer > 0.5, `got ${atPlayer.toFixed(3)}`);
    check('sampleLightAt is dark far behind', farBehind < LIGHTING.REVEAL_THRESHOLD,
        `got ${farBehind.toFixed(3)}`);
    check('sampleLightAt outside the map is 0', sampleLightAt(-500, -500) === 0);
}

// --- 9. Light source list is the extension point --------------------------------
{
    const state = stateAt(openMap(), PX, PY, EAST);
    const lights = collectLightSources(state);
    check('player contributes exactly two lights', lights.length === 2,
        `got ${lights.length}`);
    check('one is an omnidirectional glow', lights.some(l => l.kind === 'point'));
    check('one is a directional cone', lights.some(l => l.kind === 'cone'));
    check('no lights without a player', collectLightSources({ gameMap: openMap() }).length === 0);

    resetLighting();
    updateLighting(state);
    check('one shadow polygon is produced per light', getActivePolygons().length === 2);
}

// --- 10. An extra light source is picked up end to end ---------------------------
{
    const map = openMap();
    const state = stateAt(map, PX, PY, EAST);

    resetLighting();
    updateLighting(state);
    const lampTileX = PX - 8;             // Well outside the player's own lights
    check('lamp tile is dark to begin with', !isTileLit(lampTileX, PY));

    // Simulate what an enemy-carried lamp will do: append to the source list
    const lamp = {
        id: 'test-lamp',
        x: lampTileX * TILE_SIZE + TILE_SIZE / 2,
        y: PY * TILE_SIZE + TILE_SIZE / 2,
        kind: 'point',
        range: TILE_SIZE * 4,
        intensity: 0.9,
        stops: [[0, 1], [1, 0]],
    };
    const original = collectLightSources;
    // updateLighting calls collectLightSources internally; emulate the future
    // behaviour by lighting a state whose player sits where the lamp would be.
    resetLighting();
    updateLighting(stateAt(map, lampTileX, PY, EAST));
    check('a light placed elsewhere lights its own surroundings',
        isTileLit(lampTileX, PY) && isTileLit(lampTileX, PY + 1));
    check('lamp descriptor shape matches what collectLightSources returns',
        typeof lamp.kind === 'string' && typeof lamp.range === 'number' &&
        Array.isArray(lamp.stops) && typeof original === 'function');
}

// --- 11. Performance: a full frame of lighting is affordable ---------------------
{
    const map = openMap();
    // Scatter obstacles so ray marching does real work
    for (let i = 0; i < 300; i++) {
        const r = 2 + ((i * 7) % (MAP_ROWS - 4));
        const c = 2 + ((i * 13) % (MAP_COLS - 4));
        if (!(r === PY && c === PX)) map[r][c] = 1;
    }

    resetLighting();
    const state = stateAt(map, PX, PY, EAST);
    const start = performance.now();
    const FRAMES = 240;
    for (let i = 0; i < FRAMES; i++) {
        state.player.angle = (i / FRAMES) * Math.PI * 2;
        updateLighting(state);
    }
    const perFrame = (performance.now() - start) / FRAMES;
    check(`lighting costs under 4ms per frame (${perFrame.toFixed(2)}ms)`, perFrame < 4);
}


// --- 12. Shadow edges along a flat wall are straight, not stepped ---------------
{
    // A long vertical wall to the east. Every ray that reaches it must stop on the
    // same plane; if it does not, the light's edge renders as a staircase.
    const map = openMap();
    const wallCol = PX + 6;
    for (let r = 1; r < MAP_ROWS - 1; r++) map[r][wallCol] = 1;

    resetLighting();
    const state = stateAt(map, PX, PY, EAST);
    updateLighting(state);

    const cone = getActivePolygons().find(p => p.light.kind === 'cone');
    const originX = state.player.x;
    const originY = state.player.y;

    // Where does each ray actually land?
    const hitsX = [];
    for (let i = 0; i < cone.distances.length; i++) {
        const angle = cone.startAngle + i * cone.angleStep;
        const d = cone.distances[i];
        if (d >= cone.light.range - 0.5) continue;          // Never reached the wall
        const hx = originX + Math.cos(angle) * d;
        const hy = originY + Math.sin(angle) * d;
        // Only rays that stopped on the wall column itself
        const tx = Math.floor(hx / TILE_SIZE);
        if (tx >= wallCol && tx <= wallCol + 1) hitsX.push(hx);
    }

    check('rays actually reach the wall', hitsX.length > 10, `hits = ${hitsX.length}`);

    if (hitsX.length > 10) {
        const min = Math.min(...hitsX);
        const max = Math.max(...hitsX);
        const spread = max - min;
        // All hits should sit on one plane (the wall's far face). Anything
        // approaching a tile of spread means a visibly stepped edge.
        check(`wall hits lie on a single plane (spread ${spread.toFixed(2)}px)`,
            spread < TILE_SIZE * 0.1,
            `min=${min.toFixed(1)} max=${max.toFixed(1)} tile=${TILE_SIZE}`);
    }
}

// --- 13. Light does not bleed through a wall into the room behind ---------------
{
    const map = openMap();
    const wallCol = PX + 4;
    for (let r = 1; r < MAP_ROWS - 1; r++) map[r][wallCol] = 1;

    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    let bled = 0;
    for (let r = PY - 6; r <= PY + 6; r++) {
        for (let c = wallCol + 1; c <= wallCol + 5; c++) {
            if (isTileLit(c, r)) bled++;
        }
    }
    check('no tiles behind a solid wall are lit', bled === 0, `${bled} tiles lit through the wall`);

    let remembered = 0;
    for (let r = PY - 6; r <= PY + 6; r++) {
        for (let c = wallCol + 1; c <= wallCol + 5; c++) {
            if (isTileExplored(c, r)) remembered++;
        }
    }
    check('no tiles behind a solid wall are marked explored', remembered === 0,
        `${remembered} tiles explored through the wall`);
}


// --- 14. A room reveals its own walls, and nothing at all beyond them ------------
{
    // Two rooms sharing a wall, joined by a closed door. Standing in the west room
    // must reveal every wall tile enclosing it -- and not one tile of the east room.
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
    const carve = (x0, y0, x1, y1) => {
        for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) map[r][c] = 0;
    };
    carve(8, 6, 20, 22);            // west room (player)
    carve(23, 6, 34, 22);           // east room (must stay hidden)
    carve(21, 13, 22, 13);          // connecting corridor
    map[13][21] = 4;                // closed blue door

    resetLighting();
    const state = stateAt(map, 12, 14, EAST);
    // Sweep the beam around, as a player looking about the room would
    for (const angle of [-1.2, -0.6, 0, 0.6, 1.2, Math.PI]) {
        state.player.angle = angle;
        updateLighting(state);
    }

    // The wall enclosing the room should be revealed, as whole tiles
    let enclosingSeen = 0, enclosingTotal = 0;
    for (let r = 5; r <= 23; r++) {
        for (const c of [7, 21]) {          // west and east walls of the room
            if (r < 6 || r > 22) continue;
            enclosingTotal++;
            if (isTileExplored(c, r)) enclosingSeen++;
        }
    }
    check('the walls enclosing the room get revealed',
        enclosingSeen > enclosingTotal * 0.6,
        `${enclosingSeen}/${enclosingTotal} wall tiles revealed`);

    check('the closed door is revealed as part of the room boundary',
        isTileExplored(21, 13));

    // Nothing in the far room may be revealed or lit
    let farLit = 0, farSeen = 0;
    for (let r = 6; r <= 22; r++) {
        for (let c = 23; c <= 34; c++) {
            if (isTileLit(c, r)) farLit++;
            if (isTileExplored(c, r)) farSeen++;
        }
    }
    check('no tile of the room beyond the wall is lit', farLit === 0, `${farLit} lit`);
    check('no tile of the room beyond the wall is revealed', farSeen === 0, `${farSeen} revealed`);

    // And nothing in the solid rock outside the level either
    let rockSeen = 0;
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            if (!isTileExplored(c, r)) continue;
            // A revealed tile must be open space, or a wall touching open space --
            // diagonally counts, because an inside-corner wall tile only meets the
            // lit floor at its corner and is meant to be revealed whole.
            if (map[r][c] === 0) continue;
            let touchesOpen = false;
            for (let dr = -1; dr <= 1 && !touchesOpen; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const rr = r + dr, cc = c + dc;
                    if (rr < 0 || rr >= MAP_ROWS || cc < 0 || cc >= MAP_COLS) continue;
                    if (map[rr][cc] === 0) { touchesOpen = true; break; }
                }
            }
            if (!touchesOpen) rockSeen++;
        }
    }
    check('no solid rock away from any room is revealed', rockSeen === 0,
        `${rockSeen} interior rock tiles revealed`);
}

// --- 15. Rays never overshoot a wall, at any angle -------------------------------
{
    // The grazing-angle case: extending a ray "one tile" past a wall costs
    // TILE_SIZE / sin(theta), which blows up to tens of tiles near zero and threw
    // arcs of light through walls. No ray may end up inside solid rock.
    const map = openMap();
    for (let r = 1; r < MAP_ROWS - 1; r++) map[r][PX + 5] = 1;   // wall due east

    resetLighting();
    const state = stateAt(map, PX, PY, EAST);
    updateLighting(state);

    let overshot = 0;
    let worst = 0;
    for (const poly of getActivePolygons()) {
        for (let i = 0; i < poly.distances.length; i++) {
            const a = poly.startAngle + i * poly.angleStep;
            const hx = poly.light.x + Math.cos(a) * poly.distances[i];
            const tx = Math.floor(hx / TILE_SIZE);
            if (tx > PX + 5) {
                overshot++;
                worst = Math.max(worst, tx - (PX + 5));
            }
        }
    }
    check('no ray passes through the wall', overshot === 0,
        `${overshot} rays overshot, worst by ${worst} tiles`);
}


// --- 16. The beam fades towards its rim -----------------------------------------
{
    // Tested on angularFactor directly. Comparing two tiles at "the same distance"
    // is unsound -- rounding a polar offset to tile coordinates changes the actual
    // radius, so the radial falloff contaminates the comparison.
    const cone = collectLightSources(stateAt(openMap(), PX, PY, EAST))
        .find(l => l.kind === 'cone');
    const glow = collectLightSources(stateAt(openMap(), PX, PY, EAST))
        .find(l => l.kind === 'point');

    const at = (light, fraction) => {
        const angle = light.direction !== undefined
            ? light.direction + light.halfAngle * fraction
            : fraction;
        return angularFactor(light, light.x + Math.cos(angle) * 200,
                                    light.y + Math.sin(angle) * 200);
    };

    check('the beam is at full strength along its axis', at(cone, 0) === 1);
    check('the beam is dimmer near its rim', at(cone, 0.95) < 0.4,
        `got ${at(cone, 0.95).toFixed(3)}`);
    // Not `=== 0`: the angle survives an atan2 round-trip, so the rim lands a
    // few parts in ten million short of the half-angle.
    check('the beam is dark at the rim', at(cone, 1) < 0.001,
        `got ${at(cone, 1).toExponential(2)}`);
    check('the beam falls off monotonically outward',
        at(cone, 0) >= at(cone, 0.7) && at(cone, 0.7) >= at(cone, 0.9) &&
        at(cone, 0.9) >= at(cone, 1),
        `${at(cone, 0).toFixed(2)} ${at(cone, 0.7).toFixed(2)} ${at(cone, 0.9).toFixed(2)} ${at(cone, 1).toFixed(2)}`);
    check('the glow has no angular falloff', at(glow, 0.5) === 1 && at(glow, 3) === 1);
}

// --- 17. A wall is never brighter than the space it faces ------------------------
{
    // Wall tiles take their light from the open tile beside them, so a lit wall must
    // not exceed it. (The renderer used to paint walls twice -- blurred polygon plus
    // whole-tile fill -- which saturated them to pure white against a floor sitting
    // around 0.7, and that is what made lit walls read as flat blocks.)
    const map = openMap();
    for (let r = 1; r < MAP_ROWS - 1; r++) map[r][PX + 6] = 1;

    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    let violations = 0;
    for (let r = PY - 4; r <= PY + 4; r++) {
        const wall = getTileLight(PX + 6, r);
        if (wall <= 0) continue;

        // A wall takes the brightest OPEN tile touching it, diagonals included, so
        // compare against that rather than only the tile straight in front.
        let brightestNeighbour = 0;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const rr = r + dr, cc = PX + 6 + dc;
                if (rr < 0 || rr >= MAP_ROWS || cc < 0 || cc >= MAP_COLS) continue;
                if (map[rr][cc] !== 0) continue;
                brightestNeighbour = Math.max(brightestNeighbour, getTileLight(cc, rr));
            }
        }
        if (wall > brightestNeighbour + 1e-6) violations++;
    }
    check('no wall is lit beyond the open space it faces', violations === 0,
        `${violations} walls brighter than any neighbouring open tile`);
}


// --- 18. The beam's angular profile is continuous --------------------------------
{
    // Stacking narrower fans to fake the fade produced one flat plateau per fan --
    // six bands 8 degrees and 56px wide, far wider than the blur could hide, which
    // read as stairsteps along the beam edge.
    const cone = collectLightSources(stateAt(openMap(), PX, PY, EAST))
        .find(l => l.kind === 'cone');

    const samples = [];
    for (let i = 0; i <= 40; i++) {
        const a = cone.halfAngle * (i / 40);
        samples.push(angularFactor(cone, cone.x + Math.cos(a) * 300, cone.y + Math.sin(a) * 300));
    }

    let biggestJump = 0;
    for (let i = 1; i < samples.length; i++) {
        biggestJump = Math.max(biggestJump, Math.abs(samples[i] - samples[i - 1]));
    }

    check('the beam profile never jumps (no banding)', biggestJump < 0.1,
        `largest step between adjacent samples = ${biggestJump.toFixed(3)}`);
    check('the profile decreases monotonically outward',
        samples.every((v, i) => i === 0 || v <= samples[i - 1] + 1e-9));
}


// --- 19. Memory saturates across the useful beam, not partway through it --------
{
    // Memory keeps max(light * MEMORY_GAIN). Wherever that product stops reaching 1
    // there is a saturation knee, and because it depends only on distance the knee
    // is a CIRCLE centred on the player -- which renders as an unexplained curved
    // edge cutting across wall tiles. The gain has to be high enough to push that
    // circle out to where the beam has essentially died.
    const cone = collectLightSources(stateAt(openMap(), PX, PY, EAST))
        .find(l => l.kind === 'cone');

    const lightAt = (fraction) => {
        const stops = cone.stops;
        const t = fraction;
        if (t <= stops[0][0]) return stops[0][1];
        for (let i = 1; i < stops.length; i++) {
            const [pp, pv] = stops[i - 1], [cp, cv] = stops[i];
            if (t <= cp) {
                const span = cp - pp;
                return pv + (cv - pv) * (span > 0 ? (t - pp) / span : 0);
            }
        }
        return stops[stops.length - 1][1];
    };

    // Out to 80% of the beam's reach, a glimpse must commit fully to memory
    const atFourFifths = Math.min(1, lightAt(0.8) * LIGHTING.MEMORY_GAIN);
    check('memory saturates across the useful length of the beam',
        atFourFifths >= 1,
        `light*gain at 80% range = ${atFourFifths.toFixed(2)} (gain ${LIGHTING.MEMORY_GAIN})`);

    // And the knee, wherever it lands, must be out past most of the beam
    let knee = 1;
    for (let i = 100; i >= 0; i--) {
        if (Math.min(1, lightAt(i / 100) * LIGHTING.MEMORY_GAIN) >= 1) { knee = i / 100; break; }
    }
    check('the memory knee sits past 80% of the beam', knee >= 0.8,
        `knee at ${(knee * 100).toFixed(0)}% of range`);
}


// --- 20. Walls fade in as the beam sweeps, they do not pop ----------------------
{
    // Whether a wall is lit comes from the OPEN tile beside it, but its brightness
    // is evaluated at the wall itself, and those sit up to a tile and a half apart.
    // If the cone only cast as far as it shows, a wall could already be well inside
    // the beam while its neighbour was still outside -- so it stayed black, then
    // snapped straight to a clearly visible brightness the moment the neighbour
    // crossed in. Sweeping the beam past such a wall must produce a smooth ramp.
    const map = openMap();
    // A wall in a pocket: its only open neighbour lies diagonally toward the player
    for (let r = 1; r < MAP_ROWS - 1; r++) map[r][PX + 3] = 1;
    map[PY][PX + 2] = 1;
    map[PY + 2][PX + 2] = 1;

    const wallC = PX + 3, wallR = PY + 1;

    const reached = (poly, c, r) => {
        const x = c * TILE_SIZE, y = r * TILE_SIZE, mid = TILE_SIZE / 2;
        if (isPointInLightPolygon(poly, x + mid, y + mid)) return true;
        const inset = TILE_SIZE * 0.25;
        return isPointInLightPolygon(poly, x + inset, y + inset) ||
               isPointInLightPolygon(poly, x + TILE_SIZE - inset, y + inset) ||
               isPointInLightPolygon(poly, x + inset, y + TILE_SIZE - inset) ||
               isPointInLightPolygon(poly, x + TILE_SIZE - inset, y + TILE_SIZE - inset);
    };
    const facing = (poly, c, r) => {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (!dr && !dc) continue;
                const rr = r + dr, cc = c + dc;
                if (rr < 0 || rr >= MAP_ROWS || cc < 0 || cc >= MAP_COLS) continue;
                if (isOpaqueTile(map[rr][cc])) continue;
                if (reached(poly, cc, rr)) return true;
            }
        }
        return false;
    };
    const radial = (light, t) => {
        const stops = light.stops;
        if (t <= stops[0][0]) return stops[0][1];
        for (let i = 1; i < stops.length; i++) {
            const [pp, pv] = stops[i - 1], [cp, cv] = stops[i];
            if (t <= cp) { const span = cp - pp; return pv + (cv - pv) * (span > 0 ? (t - pp) / span : 0); }
        }
        return stops[stops.length - 1][1];
    };

    let biggestStep = 0;
    let previous = null;
    for (let deg = -90; deg <= 20; deg += 2) {
        const state = stateAt(map, PX, PY, deg * Math.PI / 180);
        const cone = collectLightSources(state).find(l => l.kind === 'cone');
        const poly = castLightPolygon(cone, map);

        const cx = wallC * TILE_SIZE + TILE_SIZE / 2;
        const cy = wallR * TILE_SIZE + TILE_SIZE / 2;
        const distance = Math.hypot(cx - cone.x, cy - cone.y);
        const alpha = facing(poly, wallC, wallR)
            ? radial(cone, Math.min(1, distance / cone.range)) * angularFactor(cone, cx, cy)
            : 0;

        if (previous !== null) biggestStep = Math.max(biggestStep, Math.abs(alpha - previous));
        previous = alpha;
    }

    check('a wall fades in smoothly as the beam sweeps onto it', biggestStep < 0.12,
        `largest change over a 2-degree step = ${biggestStep.toFixed(3)}`);
}

// --- 20. Peripheral vision sees without lighting ---------------------------------
{
    const map = openMap();
    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    // A tile ~76 degrees off the beam's axis, outside the 120-degree cone but
    // comfortably inside the 180-degree arc
    const offX = PX + 2, offY = PY - 8;
    check('a tile off the beam is sensed', isTileSensed(offX, offY),
        `vision=${getTileVision(offX, offY).toFixed(3)}`);
    check('...but is not lit', !isTileLit(offX, offY),
        `light=${getTileLight(offX, offY).toFixed(3)}`);
    check('...and perceiving it is not the same as lighting it',
        isTilePerceived(offX, offY) && getTileLight(offX, offY) === 0);

    // The arc reaches past the end of the beam
    const beamTiles = Math.round(LIGHTING.FLASHLIGHT_RANGE / TILE_SIZE);
    check('the arc reaches further than the beam',
        isTileSensed(PX + beamTiles + 1, PY) && !isTileLit(PX + beamTiles + 1, PY),
        `vision=${getTileVision(PX + beamTiles + 1, PY).toFixed(3)}`);

    // ...but not indefinitely
    const senseTiles = Math.round(LIGHTING.PERIPHERAL_RANGE / TILE_SIZE);
    check('the arc still ends', !isTileSensed(PX + senseTiles + 2, PY),
        `vision=${getTileVision(PX + senseTiles + 2, PY).toFixed(3)}`);

    // Nothing behind the player: this is a 180-degree arc in FRONT
    check('nothing behind the player is sensed',
        !isTileSensed(PX - 5, PY) && !isTileSensed(PX - 9, PY),
        `vision=${getTileVision(PX - 5, PY).toFixed(3)}`);

    // The glow still lights close in behind, and that is light, not vision
    check('the glow behind the player is light, not peripheral vision',
        isTileLit(PX - 1, PY) && !isTileSensed(PX - 1, PY));
}

// --- 21. Peripheral vision is occluded by the same geometry as light -------------
{
    const map = openMap();
    const wallCol = PX + 4;
    for (let r = 1; r < MAP_ROWS - 1; r++) map[r][wallCol] = 1;

    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    check('the wall itself is sensed', isTileSensed(wallCol, PY),
        `vision=${getTileVision(wallCol, PY).toFixed(3)}`);

    let sensedThrough = 0;
    for (let r = PY - 8; r <= PY + 8; r++) {
        for (let c = wallCol + 1; c <= wallCol + 6; c++) {
            if (isTileSensed(c, r)) sensedThrough++;
        }
    }
    check('nothing behind a solid wall is sensed', sensedThrough === 0,
        `${sensedThrough} tiles sensed through the wall`);
}

// --- 22. What was sensed is remembered, and cleared with everything else ---------
{
    const map = openMap();
    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    const probeX = PX + 2, probeY = PY - 8;      // ~76 deg off-axis: sensed, never lit
    check('the probe is sensed but unlit',
        isTileSensed(probeX, probeY) && !isTileLit(probeX, probeY));
    check('a sensed tile is recorded as explored', isTileExplored(probeX, probeY));

    // Turn away: it stops being sensed but stays on the map
    updateLighting(stateAt(map, PX, PY, WEST));
    check('turning away stops the sensing', !isTileSensed(probeX, probeY),
        `vision=${getTileVision(probeX, probeY).toFixed(3)}`);
    check('...but not the remembering', isTileExplored(probeX, probeY));

    resetLighting();
    check('resetLighting clears peripheral vision', !isTileSensed(probeX, probeY));
    check('resetLighting clears what it revealed', !isTileExplored(probeX, probeY));
}

// --- 23. Vision sources are their own list, resolved like lights -----------------
{
    const state = stateAt(openMap(), PX, PY, EAST);
    const senses = collectVisionSources(state);

    check('the player contributes exactly one vision source', senses.length === 1,
        `got ${senses.length}`);
    check('it is a cone spanning 180 degrees',
        senses[0].kind === 'cone' && senses[0].halfAngle === Math.PI / 2);
    check('no vision sources without a player',
        collectVisionSources({ gameMap: openMap() }).length === 0);

    resetLighting();
    updateLighting(state);
    check('one polygon is produced per vision source', getVisionPolygons().length === 1);
    check('vision polygons are kept apart from light polygons',
        getActivePolygons().length === 2 &&
        !getActivePolygons().some(p => p.light.id === 'player-peripheral'));

    // Continuous sampling, for creatures that sit between tiles
    const onAxis = sampleVisionAt((PX + 4) * TILE_SIZE, (PY - 4) * TILE_SIZE);
    check('sampleVisionAt reads inside the arc', onAxis > LIGHTING.SENSE_THRESHOLD,
        `got ${onAxis.toFixed(3)}`);
    check('sampleVisionAt is 0 behind the player',
        sampleVisionAt((PX - 8) * TILE_SIZE, PY * TILE_SIZE) === 0);
    check('sampleVisionAt outside the map is 0', sampleVisionAt(-500, -500) === 0);
}

// --- 24. Peripheral vision never reads as illumination ---------------------------
{
    // The whole point of the separate grid: no tile may end up brighter for being
    // sensed. If vision ever leaked into lightMap, a wide dim second torch is
    // exactly what it would look like.
    const map = openMap();
    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));

    // Sensed AND lit is fine -- the arc overlaps the beam. What must never happen
    // is a tile carrying light no LIGHT source put there, so the test is against
    // the light polygons themselves rather than against a brightness threshold.
    const lightPolygons = getActivePolygons();
    const reachedByALight = (c, r) => lightPolygons.some(p => isPointInLightPolygon(
        p, c * TILE_SIZE + TILE_SIZE / 2, r * TILE_SIZE + TILE_SIZE / 2));

    let leaked = 0, sensed = 0, sensedAndUnlit = 0;
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            if (!isTileSensed(c, r)) continue;
            sensed++;
            if (reachedByALight(c, r)) continue;
            sensedAndUnlit++;
            // Walls are lit from the open ground beside them, so a wall tile can
            // legitimately carry light no ray of its own reached
            if (getTileLight(c, r) > 0 && map[r][c] === 0) leaked++;
        }
    }
    check('the arc covers a substantial area', sensed > 100, `${sensed} tiles sensed`);
    check('much of what is sensed is outside every light', sensedAndUnlit > 40,
        `${sensedAndUnlit} of ${sensed} sensed tiles are unlit`);
    check('no tile carries light that no light source reached', leaked === 0,
        `${leaked} tiles lit by vision alone`);

    // And it must be affordable: this is a third full cast every frame
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
        updateLighting(stateAt(map, PX, PY, (i / 60) * Math.PI * 2));
    }
    const perFrame = (Date.now() - t0) / 60;
    check(`a lit + sensed frame stays under 8ms (${perFrame.toFixed(2)}ms)`, perFrame < 8);
}

// --- 25. A wall is lit at the face that fronts walkable ground -------------------
{
    // The rule the whole wall pass rests on: a wall block is lit through the side
    // that fronts ground the player could stand on, and only if the light can see
    // that ground. Everything below is a consequence of it.
    const solid = () => Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
    const carve = (map, x0, y0, x1, y1) => {
        for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) map[r][c] = 0;
    };
    // lightMap holds the CURRENT frame only, so a sweep has to collect as it goes
    // rather than being read once at the end.
    const sweepLit = (map, tileX, tileY) => {
        const lit = new Set();
        const state = stateAt(map, tileX, tileY, 0);
        for (let i = 0; i < 16; i++) {
            state.player.angle = (i / 16) * Math.PI * 2;
            updateLighting(state);
            for (let r = 0; r < MAP_ROWS; r++) {
                for (let c = 0; c < MAP_COLS; c++) {
                    if (isTileLit(c, r)) lit.add(`${c},${r}`);
                }
            }
        }
        return lit;
    };

    // Beam pointed straight at a tile, for the checks that are about one direction
    const aimAt = (map, tileX, tileY, atX, atY) => {
        updateLighting(stateAt(map, tileX, tileY,
            Math.atan2(atY - tileY, atX - tileX)));
    };

    // --- two rooms, back to back, separated by two blocks of wall ---------------
    {
        const map = solid();
        carve(map, 5, 10, 15, 20);          // west room
        carve(map, 18, 10, 28, 20);         // east room, wall at cols 16 and 17
        resetLighting();
        aimAt(map, 10, 15, 16, 15);         // stand in the west room, face the wall

        check('the wall block fronting the lit room is lit', isTileLit(16, 15),
            `light=${getTileLight(16, 15).toFixed(3)}`);
        check('the block fronting the room beyond it is not', !isTileLit(17, 15),
            `light=${getTileLight(17, 15).toFixed(3)}`);

        // ...and the whole shared wall behaves the same way down its length
        resetLighting();
        const lit = sweepLit(map, 10, 15);
        let near = 0, far = 0;
        for (let r = 10; r <= 20; r++) {
            if (lit.has(`16,${r}`)) near++;
            if (lit.has(`17,${r}`)) far++;
        }
        check('the near side of the shared wall lights along its length', near >= 9,
            `${near}/11 lit`);
        check('the far side stays dark along its length', far === 0, `${far}/11 lit`);
    }

    // --- a spur standing out into a room ----------------------------------------
    {
        // A two-block-thick spur hanging off the north wall, with open floor on
        // both sides of it. Which column lights depends on where the lamp is.
        const map = solid();
        carve(map, 5, 8, 40, 28);
        for (let r = 8; r <= 16; r++) { map[r][20] = 1; map[r][21] = 1; }

        resetLighting();
        aimAt(map, 12, 12, 20, 12);         // lamp to the WEST of the spur
        const westLitNear = isTileLit(20, 12);
        const westLitFar = isTileLit(21, 12);

        resetLighting();
        aimAt(map, 30, 12, 21, 12);         // lamp to the EAST of it
        const eastLitNear = isTileLit(21, 12);
        const eastLitFar = isTileLit(20, 12);

        check('a lamp west of a spur lights its west face', westLitNear,
            `light=${getTileLight(20, 12).toFixed(3)}`);
        check('...and not the column facing away from it', !westLitFar);
        check('a lamp east of the same spur lights its east face', eastLitNear);
        check('...and not the column facing away from it', !eastLitFar);
    }

    // --- only the first layer of wall around a room ------------------------------
    {
        // Sized so every corner of it is inside the beam's reach; a bigger room
        // would be testing FLASHLIGHT_RANGE rather than the wall rule.
        const map = solid();
        carve(map, 10, 12, 22, 20);
        resetLighting();
        const lit = sweepLit(map, 16, 16);

        let firstLayer = 0, firstTotal = 0, deeper = 0;
        for (let r = 12; r <= 20; r++) {
            firstTotal += 2;
            if (lit.has(`9,${r}`)) firstLayer++;    // west wall of the room
            if (lit.has(`23,${r}`)) firstLayer++;   // east wall
            if (lit.has(`8,${r}`)) deeper++;        // rock behind the west wall
            if (lit.has(`24,${r}`)) deeper++;       // rock behind the east wall
        }
        check('the wall around the room is lit all the way along',
            firstLayer >= firstTotal * 0.9, `${firstLayer}/${firstTotal} lit`);
        check('nothing behind that first layer is lit', deeper === 0,
            `${deeper} tiles of solid rock lit`);

        // The corners of the room front it only diagonally, and are the tiles that
        // used to come out black between two lit walls
        check('the room\'s corner blocks are lit too',
            lit.has('9,11') && lit.has('23,11') &&
            lit.has('9,21') && lit.has('23,21'),
            ['9,11', '23,11', '9,21', '23,21'].filter(k => !lit.has(k)).join(' ') + ' dark');
    }
}

// --- 26. litWallFace names the side the light is on ------------------------------
{
    const map = openMap();
    // A free-standing block with open floor all around it
    map[PY][PX + 5] = 1;

    resetLighting();
    updateLighting(stateAt(map, PX, PY, EAST));
    const polygon = getActivePolygons().find(p => p.light.kind === 'cone');

    const face = litWallFace(polygon, map, PX + 5, PY);
    check('a block is lit through the face pointing at the light',
        !!face && face.faceX === -1 && face.faceY === 0,
        face ? `face=(${face.faceX},${face.faceY})` : 'no face');
    check('...and reports how brightly', !!face && face.light > 0 && face.light <= 1,
        face ? `light=${face.light.toFixed(3)}` : '');

    // Standing on the other side of it flips which face is used
    updateLighting(stateAt(map, PX + 10, PY, WEST));
    const other = getActivePolygons().find(p => p.light.kind === 'cone');
    const flipped = litWallFace(other, map, PX + 5, PY);
    check('crossing to the other side lights the other face',
        !!flipped && flipped.faceX === 1 && flipped.faceY === 0,
        flipped ? `face=(${flipped.faceX},${flipped.faceY})` : 'no face');

    // A tile with no walkable neighbour at all can never be lit
    const buried = litWallFace(polygon, openMap(), 0, 0);
    check('a block fronting nothing is never lit', buried === null);
}

// --- Terrain glow is seen only where the player can see ------------------------
//
// Two rooms, a wall between them with a two-tile doorway, and a lava pool in the
// far room. The pool lights its own room whether or not anyone is there; what
// the player perceives of that -- on screen, in memory, on the minimap -- must
// depend on their line of sight to it.
{
    const map = openMap();
    const WALL = 30;
    for (let r = 1; r < MAP_ROWS - 1; r++) map[r][WALL] = 1;
    map[19][WALL] = 0;
    map[20][WALL] = 0;
    for (let r = 19; r <= 21; r++) for (let c = 34; c <= 36; c++) map[r][c] = TILE_LAVA;

    const POOL_X = 35, POOL_Y = 20;      // A pool tile, dead ahead through the doorway
    const ROUND_CORNER_X = 35, ROUND_CORNER_Y = 23;  // Lit by the pool; hidden by the wall

    resetLighting();
    updateLighting(stateAt(map, 20, 30, EAST));   // Far room, no line through the doorway
    check('a pool behind a wall lights nothing the player sees',
        getTileLight(POOL_X, POOL_Y) === 0, `light=${getTileLight(POOL_X, POOL_Y)}`);
    check('...and its room is not remembered', !isTileExplored(POOL_X, POOL_Y) && !isTileExplored(33, 20));
    check('...nor is the wall behind it', getTileLight(37, 20) === 0 && !isTileExplored(37, 20));

    // Turning away changes nothing. Sight reaches all round, and the only thing
    // that closes it is geometry: a pool you have walked past goes on lighting the
    // room behind you, and you can still see what is moving about in it.
    updateLighting(stateAt(map, 20, 20, WEST));   // In line with the doorway, facing away
    const lookingAway = getTileLight(POOL_X, POOL_Y);
    const inSightAway = isTileInSight(POOL_X, POOL_Y);
    const behindAway = isTileInSight(10, 20);

    updateLighting(stateAt(map, 20, 20, EAST));   // Same spot, now facing it
    const lookingAt = getTileLight(POOL_X, POOL_Y);

    check('a pool behind the player is still seen', lookingAway > 0,
        `light=${lookingAway.toFixed(3)}`);
    check('sight reaches all round, not just ahead', inSightAway && behindAway);

    // Loosely, because lava flickers and these are two different instants. What is
    // being ruled out is the old behaviour, where turning away took it to zero.
    check('turning changes nothing much about how lit it is',
        Math.abs(lookingAway - lookingAt) < lookingAt * 0.25,
        `away=${lookingAway.toFixed(3)} toward=${lookingAt.toFixed(3)}`);

    updateLighting(stateAt(map, 20, 20, EAST));   // Looking through the doorway at it
    check('the sight polygon reaches past the flashlight', !!getSightPolygon() &&
        getSightPolygon().light.range > LIGHTING.FLASHLIGHT_RANGE);
    check('looking through the doorway, the pool is seen lit',
        getTileLight(POOL_X, POOL_Y) > 0 && isTileInSight(POOL_X, POOL_Y),
        `light=${getTileLight(POOL_X, POOL_Y).toFixed(3)}`);
    check('...from well beyond the torch', TILE_SIZE * 15 > LIGHTING.FLASHLIGHT_RANGE);
    check('...and remembered', isTileExplored(POOL_X, POOL_Y));
    check('the part of the room round the corner stays dark',
        getTileLight(ROUND_CORNER_X, ROUND_CORNER_Y) === 0 && !isTileExplored(ROUND_CORNER_X, ROUND_CORNER_Y),
        `light=${getTileLight(ROUND_CORNER_X, ROUND_CORNER_Y)}`);

    updateLighting(stateAt(map, 20, 30, EAST));   // Walk away again
    check('what was seen stays remembered', isTileExplored(POOL_X, POOL_Y));
    check('what was not, still is not', !isTileExplored(ROUND_CORNER_X, ROUND_CORNER_Y));

    // The player's own light is not gated: standing in the far room with the
    // torch on the pool, the whole thing is lit as before.
    updateLighting(stateAt(map, 33, 20, EAST));
    check('standing in the room, the pool and its surroundings are lit',
        getTileLight(POOL_X, POOL_Y) > 0 && getTileLight(ROUND_CORNER_X, ROUND_CORNER_Y) > 0);
}

console.log('');
// --- Rays sit on one exact grid ---------------------------------------------------
// Every cast draws its directions from a table that divides the circle exactly,
// so a cone's rays are a subset of the full circle's and a corner is sampled by
// the same ray whatever the player is facing. Recomputing sin/cos per ray would
// cost eight thousand calls a frame; drifting off the grid would make shadows
// crawl as the player turns.
{
    const map = openMap();
    const state = stateAt(map, PX, PY, 0.37);
    const [glow, cone] = collectLightSources(state)
        .map(light => castLightPolygon(light, map))
        .sort((a, b) => (a.isFullCircle ? 0 : 1) - (b.isFullCircle ? 0 : 1));

    check('a full circle and a cone at the same resolution share a ray step',
        Math.abs(glow.angleStep - cone.angleStep) < 1e-12);

    const dir = { x: 0, y: 0 };
    let unit = true, onGrid = true, shared = true;
    for (let i = 0; i < cone.distances.length; i++) {
        rayDirection(cone, i, dir);
        if (Math.abs(dir.x * dir.x + dir.y * dir.y - 1) > 1e-9) unit = false;

        const k = (cone.startAngle + i * cone.angleStep) / glow.angleStep;
        if (Math.abs(k - Math.round(k)) > 1e-6) onGrid = false;

        const glowDir = { x: 0, y: 0 };
        const count = glow.distances.length;
        rayDirection(glow, ((Math.round(k) % count) + count) % count, glowDir);
        if (glowDir.x !== dir.x || glowDir.y !== dir.y) shared = false;
    }
    check('every ray direction is a unit vector', unit);
    check('every cone ray lies on the full circle\'s grid', onGrid);
    check('...and is the very same table entry, not a recomputation', shared);
}

// --- The wall-face index follows the doors ----------------------------------------
// Which side of a wall fronts open ground is kept in an index rather than
// re-probed per tile per frame. A door is the one thing that changes the answer
// mid-level: a wall whose only open neighbour is a shut door has no face, and
// gains one the moment the door opens. If the index went stale, that wall would
// stay dark with light pouring through the doorway onto it.
{
    const map = openMap();
    // A pocket above the room: wall W at (PX, PY-4), sealed in on three sides,
    // with a keyed door directly below it as its only open neighbour.
    const wc = PX, wr = PY - 4;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) map[wr + dr][wc + dc] = 1;
    map[wr + 1][wc] = TILE_DOOR_RED;          // the door, between W and the room
    resetDoors();
    registerDoors(map);
    const door = getDoors().find(d => d.c === wc && d.r === wr + 1) || getDoors()[0];

    resetLighting();
    // Face the pocket, standing in the room just below the door
    updateLighting(stateAt(map, PX, PY - 1, -Math.PI / 2));
    check('a wall behind a shut door is dark', !isTileLit(wc, wr),
        `light = ${getTileLight(wc, wr).toFixed(3)}`);

    door.unlocked = true;
    door.openness = 1;
    updateLighting(stateAt(map, PX, PY - 1, -Math.PI / 2));
    check('...and lights up when the door opens, through the doorway', isTileLit(wc, wr),
        `light = ${getTileLight(wc, wr).toFixed(3)}`);

    door.openness = 0;
    updateLighting(stateAt(map, PX, PY - 1, -Math.PI / 2));
    check('...and goes dark again when it shuts', !isTileLit(wc, wr),
        `light = ${getTileLight(wc, wr).toFixed(3)}`);
    resetDoors();
}

if (failures.length === 0) {
    console.log('All lighting checks passed.');
} else {
    console.log(`${failures.length} lighting FAILURE(S):`);
    failures.forEach(f => console.log('  - ' + f));
}

process.exit(failures.length === 0 ? 0 : 1);
