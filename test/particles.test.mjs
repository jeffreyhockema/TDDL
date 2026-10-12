// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Particle and decal checks. Run with: npm test
 *
 * The effects never touch play, so what matters is that they appear when they
 * should, stay within their budgets, and draw without throwing on the render
 * path's canvas -- a particle system that leaks or NaNs is a slow death for a
 * long session.
 */

import { TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_LAVA, TILE_TOXIC, TILE_WATER } from '../js/constants.js';
import {
    PARTICLES, resetParticles, updateParticles, getParticles, getDecals,
    spawnBlood, spawnGore, spawnSplash, drawParticles, drawDecals, hexToRgb,
} from '../js/particles.js';

let failures = 0;
function check(label, condition, detail = '') {
    if (condition) {
        console.log(`  ok    ${label}`);
    } else {
        failures++;
        console.error(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
    }
}

console.log('\n=== particles ===\n');

/** An open hall with a pool of one liquid in the middle. */
function mapWithPool(type, size = 4) {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
    for (let r = 2; r < MAP_ROWS - 2; r++) for (let c = 2; c < MAP_COLS - 2; c++) map[r][c] = 0;
    for (let r = 20; r < 20 + size; r++) for (let c = 20; c < 20 + size; c++) map[r][c] = type;
    return map;
}

const at = (c, r) => ({ x: c * TILE_SIZE + TILE_SIZE / 2, y: r * TILE_SIZE + TILE_SIZE / 2, radius: 13, isMoving: false });

function run(gs, frames) {
    for (let i = 0; i < frames; i++) updateParticles(gs);
}

const kinds = () => new Set(getParticles().map(p => p.kind));

/**
 * Runs frames and reports every kind that was alive at any point. Sparks and
 * glints live for a dozen frames; sampling one instant would be a coin toss.
 */
function kindsSeen(gs, frames) {
    const seen = new Set();
    for (let i = 0; i < frames; i++) {
        updateParticles(gs);
        for (const p of getParticles()) seen.add(p.kind);
    }
    return seen;
}

console.log('[ambient]');
{
    const gs = { gameMap: mapWithPool(TILE_LAVA), player: at(18, 22), enemies: [] };
    resetParticles(gs.gameMap);
    const seen = kindsSeen(gs, 240);
    check('lava gives off embers', seen.has('ember'), [...seen].join(','));
    check('...and the odd crackle of sparks', seen.has('spark'));

    const embers = getParticles().filter(p => p.kind === 'ember');
    const inPool = embers.every(p => p.x >= 20 * TILE_SIZE - 5 && p.x <= 24 * TILE_SIZE + 5);
    check('embers come from the pool itself', inPool);
    check('embers drift upward', embers.every(p => p.vy < 0));
}
{
    const gs = { gameMap: mapWithPool(TILE_TOXIC), player: at(18, 22), enemies: [] };
    resetParticles(gs.gameMap);
    const seen = kindsSeen(gs, 240);
    check('sludge bubbles', seen.has('bubble'));
    check('...and gives off gas', seen.has('wisp'));
}
{
    const gs = { gameMap: mapWithPool(TILE_WATER), player: at(18, 22), enemies: [] };
    resetParticles(gs.gameMap);
    const seen = kindsSeen(gs, 240);
    check('water glints', seen.has('glint'));
    check('water does not smoke or burn', !seen.has('ember') && !seen.has('wisp'));
}
{
    const gs = { gameMap: mapWithPool(TILE_LAVA), player: at(58, 44), enemies: [] };
    resetParticles(gs.gameMap);
    run(gs, 120);
    check('a pool far from the player is quiet', getParticles().length === 0, `${getParticles().length}`);
}

console.log('[wading]');
{
    const gs = { gameMap: mapWithPool(TILE_WATER), player: at(18, 22), enemies: [] };
    resetParticles(gs.gameMap);
    run(gs, 5);
    const quiet = getParticles().filter(p => p.kind === 'ripple' || p.kind === 'droplet').length;

    gs.player.x = 21 * TILE_SIZE + 20;   // step into the pool
    gs.player.isMoving = true;
    run(gs, 1);
    const splashed = getParticles().filter(p => p.kind === 'ripple' || p.kind === 'droplet').length;
    check('stepping into water splashes', splashed > quiet, `${quiet} -> ${splashed}`);

    run(gs, 30);
    check('wading keeps making ripples', getParticles().filter(p => p.kind === 'ripple').length > 0);

    gs.player.isMoving = false;
    run(gs, 60);
    check('standing still lets the water settle', getParticles().filter(p => p.kind === 'ripple').length === 0);
}
{
    const gs = { gameMap: mapWithPool(TILE_LAVA), player: at(18, 22), enemies: [] };
    resetParticles(gs.gameMap);
    gs.player.x = 21 * TILE_SIZE + 20;
    gs.player.isMoving = true;
    run(gs, 8);
    check('wading through lava throws sparks, not droplets',
        kinds().has('spark') && !kinds().has('droplet'));
}
{
    const enemy = { ...at(21, 21), isMoving: true, isDead: false, health: 50 };
    const gs = { gameMap: mapWithPool(TILE_TOXIC), player: at(18, 22), enemies: [enemy] };
    resetParticles(gs.gameMap);
    run(gs, 10);
    check('monsters disturb the pools too', getParticles().some(p => p.kind === 'ripple'));
}

console.log('[blood]');
{
    resetParticles(mapWithPool(TILE_WATER));
    const gs = { gameMap: mapWithPool(TILE_WATER), player: at(5, 5), enemies: [] };
    spawnBlood(400, 400, 0, { amount: 40 });
    const drops = getParticles().filter(p => p.kind === 'blood');
    check('a hit sprays the asked-for amount', drops.length === 40, `${drops.length}`);
    // Four in five droplets go forward; a sample this size makes it no coin toss
    const forward = drops.filter(p => p.vx > 0).length;
    check('most of it follows the shot through', forward >= 24, `${forward} of 40 forward`);
    check('there is a puff of mist at the wound', getParticles().some(p => p.kind === 'mist'));

    run(gs, 60);
    check('blood that settles becomes a stain', getDecals().length > 0 && getParticles().filter(p => p.kind === 'blood').length === 0,
        `${getDecals().length} decals`);
}
{
    resetParticles(mapWithPool(TILE_WATER));
    spawnGore(400, 400, '60,180,60', 1);
    check('a kill bleeds in every direction',
        getParticles().some(p => p.kind === 'blood' && p.vx > 0) && getParticles().some(p => p.kind === 'blood' && p.vx < 0));
    check('...in the monster\'s own colour', getParticles().every(p => p.kind !== 'blood' || p.color === '60,180,60'));
    check('...and leaves a stain at once', getDecals().length === 1);
}

console.log('[budgets]');
{
    resetParticles(mapWithPool(TILE_WATER));
    for (let i = 0; i < 200; i++) spawnBlood(400, 400, 0, { amount: 20 });
    check('the particle count is capped', getParticles().length <= PARTICLES.MAX, `${getParticles().length}`);

    const gs = { gameMap: mapWithPool(TILE_WATER), player: at(5, 5), enemies: [] };
    run(gs, 80);
    check('the decal count is capped', getDecals().length <= PARTICLES.DECAL_MAX, `${getDecals().length}`);
    check('the oldest stains go first', getDecals().length === PARTICLES.DECAL_MAX);

    for (let i = 0; i < 400; i++) spawnSplash(400, 400, TILE_TOXIC, 2);
    gs.player = at(58, 44);   // out of range of the pool, so nothing new is emitted
    run(gs, 300);
    check('everything short-lived is eventually gone', getParticles().length === 0, `${getParticles().length}`);
    check('nothing went NaN', getDecals().every(d => Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.r)));
}

console.log('[drawing]');
{
    const calls = { arc: 0, ellipse: 0, stroke: 0, fill: 0, gco: [] };
    const ctx = new Proxy({}, {
        get(_t, prop) {
            if (prop === 'arc') return () => { calls.arc++; };
            if (prop === 'ellipse') return () => { calls.ellipse++; };
            if (prop === 'stroke') return () => { calls.stroke++; };
            if (prop === 'fill') return () => { calls.fill++; };
            return () => {};
        },
        set(_t, prop, value) { if (prop === 'globalCompositeOperation') calls.gco.push(value); return true; },
    });

    const gs = { gameMap: mapWithPool(TILE_LAVA), player: at(18, 22), enemies: [] };
    resetParticles(gs.gameMap);
    run(gs, 60);
    spawnBlood(700, 800, 1, { amount: 12 });
    spawnSplash(750, 850, TILE_WATER, 1);
    run(gs, 20);

    let threw = null;
    try {
        drawParticles(ctx, 'lit');
        drawParticles(ctx, 'emissive');
        drawDecals(ctx, { startCol: 0, endCol: MAP_COLS, startRow: 0, endRow: MAP_ROWS });
    } catch (e) { threw = e; }
    check('drawing does not throw', threw === null, threw?.message);
    check('the emissive pass draws additively', calls.gco.includes('lighter'));
    check('something was drawn', calls.arc + calls.ellipse > 0);
    check('stains are drawn as ellipses', calls.ellipse > 0);
}
{
    check('palette hex converts to a triple', hexToRgb('#FFB13A') === '255,177,58');
}

console.log('');
if (failures === 0) {
    console.log('All particle checks passed.');
} else {
    console.log(`${failures} particle check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
