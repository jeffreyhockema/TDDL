// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * The player's arsenal, checked against Doom (1993). Run with: npm test
 *
 * The numbers are p_pspr.c's and info.c's: damage dice, fire rates, spreads,
 * projectile speeds, the blast, the BFG's spray and the four ammunition pools.
 * The checks drive the real Player at real monsters through the real trace.
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
const { Bullet, Explosion, traceShot } = await import('../js/weapons.js');
const { Barrel } = await import('../js/barrels.js');
const { keys, mouse, resetInputState } = await import('../js/input-handler.js');
const {
    TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL, TILE_SWITCH,
    WEAPON_STATS, AMMO_TYPES, PLAYER_SPREAD_DEGREES, rollDice, diceAverage, rollWeaponDamage, playerSpread,
} = await import('../js/constants.js');
const { registerSwitches, switchAtTile } = await import('../js/switches.js');
const sprites = await import('../js/enemy-sprites.js');
await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');

console.log = origLog;
console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

console.log('\n=== arsenal ===\n');

const T = TILE_SIZE;
const centre = (tile) => tile * T + T / 2;
const DOOM_PX = T / 64;
const FRAMES_PER_TIC = 60 / 35;
const tics = (n) => Math.round(n * FRAMES_PER_TIC);

// =============================================================================
// THE NUMBERS
// =============================================================================

console.log('[Doom\'s numbers]');
{
    const W = WEAPON_STATS;
    const dice = (name, mult, sides) => W[name].dice[0] === mult && W[name].dice[1] === sides;
    check('the knife is the fist: 2-20', dice('Knife', 2, 10));
    check('pistol, shotgun and rifle: 5-15 a bullet', dice('Pistol', 5, 3) && dice('Shotgun', 5, 3) && dice('Rifle', 5, 3));
    check('the shotgun fires seven pellets', W.Shotgun.numPellets === 7);
    check('the rocket: 20-160 on impact and a 128 blast over 128 units',
        dice('Rocket Launcher', 20, 8) && W['Rocket Launcher'].splashDamage === 128 &&
        Math.abs(W['Rocket Launcher'].aoeRadius - 128 * DOOM_PX) < 1e-9);
    check('plasma: 5-40 a bolt', dice('Plasma Gun', 5, 8));
    check('the BFG: 100-800, then forty rays of 15-120 over ninety degrees',
        dice('BFG', 100, 8) && W.BFG.tracerDice[0] === 15 && W.BFG.tracerDice[1] === 8 &&
        W.BFG.tracerCount === 40 && W.BFG.tracerConeDegrees === 90);

    check('fire rates are Doom\'s tics: fist 22, pistol 14, shotgun 37, chaingun 4, rocket 20, plasma 3, BFG 60',
        W.Knife.fireRate === tics(22) && W.Pistol.fireRate === tics(14) && W.Shotgun.fireRate === tics(37) &&
        W.Rifle.fireRate === tics(4) && W['Rocket Launcher'].fireRate === tics(20) &&
        W['Plasma Gun'].fireRate === tics(3) && W.BFG.fireRate === tics(60),
        [W.Knife, W.Pistol, W.Shotgun, W.Rifle, W['Rocket Launcher'], W['Plasma Gun'], W.BFG].map(w => w.fireRate).join('/'));
    check('projectile speeds are Doom\'s: rockets 20 and plasma 25 units a tic',
        Math.abs(W['Rocket Launcher'].bulletSpeed - 20 * DOOM_PX / FRAMES_PER_TIC) < 1e-9 &&
        Math.abs(W['Plasma Gun'].bulletSpeed - 25 * DOOM_PX / FRAMES_PER_TIC) < 1e-9 &&
        Math.abs(W.BFG.bulletSpeed - 25 * DOOM_PX / FRAMES_PER_TIC) < 1e-9);
    check('the guns are hitscan', W.Pistol.hitscan && W.Shotgun.hitscan && W.Rifle.hitscan &&
        !W['Rocket Launcher'].hitscan && !W['Plasma Gun'].hitscan && !W.BFG.hitscan);
    check('the player\'s spread is 5.6 degrees', Math.abs(PLAYER_SPREAD_DEGREES - 5.625) < 1e-9 &&
        W.Pistol.spreadDegrees === PLAYER_SPREAD_DEGREES && W.Rifle.spreadDegrees === PLAYER_SPREAD_DEGREES);
    check('every weapon refires while the trigger is held', Object.values(W).every(w => w.singleShot === false));
    check('the melee reach is MELEERANGE', Math.abs(W.Knife.meleeRange - 64 * DOOM_PX) < 1e-9);

    // Dice
    const rolls = new Set();
    for (let i = 0; i < 2000; i++) rolls.add(rollDice([5, 3]));
    check('5-15 rolls exactly 5, 10 or 15', rolls.size === 3 && [5, 10, 15].every(v => rolls.has(v)));
    check('the average is what the flat damage says', diceAverage([5, 3]) === 10 && W.Pistol.damage() === 10 && W.BFG.damage() === 450);
    check('a weapon without dice keeps its flat damage', rollWeaponDamage({ damage: 7 }) === 7);
    let maxSpread = 0, sum = 0;
    for (let i = 0; i < 4000; i++) { const s = playerSpread(); maxSpread = Math.max(maxSpread, Math.abs(s)); sum += s; }
    check('the spread stays inside 5.6 degrees and centres on zero',
        maxSpread <= PLAYER_SPREAD_DEGREES * Math.PI / 180 + 1e-9 && Math.abs(sum / 4000) < 0.01);

    // Ammunition
    check('Doom\'s four pools: bullets 200, shells 50, rockets 50, cells 300',
        AMMO_TYPES.bullets.max === 200 && AMMO_TYPES.shells.max === 50 && AMMO_TYPES.rockets.max === 50 && AMMO_TYPES.cells.max === 300);
    check('a new marine has fifty bullets and nothing else', AMMO_TYPES.bullets.start === 50 &&
        AMMO_TYPES.shells.start === 0 && AMMO_TYPES.rockets.start === 0 && AMMO_TYPES.cells.start === 0);
    check('pistol and rifle draw bullets; plasma and BFG draw cells',
        W.Pistol.ammoType === 'bullets' && W.Rifle.ammoType === 'bullets' &&
        W['Plasma Gun'].ammoType === 'cells' && W.BFG.ammoType === 'cells' &&
        W.Shotgun.ammoType === 'shells' && W['Rocket Launcher'].ammoType === 'rockets');
    check('the BFG spends forty cells a shot', W.BFG.ammoPerShot === 40);
}

// =============================================================================
// AT THE RANGE
// =============================================================================

const gs = new GameState();
gs.selectedDifficulty = 'medium';
gs.currentLevel = 1;

function hall() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_WALL));
    for (let r = 2; r < MAP_ROWS - 2; r++) for (let c = 2; c < MAP_COLS - 2; c++) map[r][c] = TILE_EMPTY;
    return map;
}

function world(px = 20, py = 20) {
    gs.gameMap = hall();
    gs.enemies = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.barrels = [];
    gs.traps = [];
    gs.temporaryVisualEffects = [];
    gs.currentBoss = null;
    gs.noiseTiles = null;
    gs.noiseFrame = -1;
    gs.player = new Player(centre(px), centre(py));
    gs.player.health = gs.player.maxHealth = 100000;
    gs.player.collectAllGuns();
    resetInputState();
    registerSwitches(null);
    return gs.player;
}

function frames(n) {
    for (let i = 0; i < n; i++) {
        gs.frameCount++;
        gs.update();
    }
}

/** Points the mouse due east of the player, so frame-driven aiming faces east. */
function aimEast() {
    mouse.x = 1200;
    mouse.y = 400;
}

function arm(player, name) {
    player.currentWeaponIndex = player.weapons.findIndex(w => w.name === name);
    player.shootCooldown = 0;
    return player.getCurrentWeapon();
}

/** Puts a monster at a tile, awake but harmless, facing away. */
function dummy(type, c, r) {
    const e = new Enemy(centre(c), centre(r), type);
    e.ambush = true;
    e.face(Math.PI);
    gs.enemies.push(e);
    return e;
}

console.log('[shared ammunition]');
{
    const player = world();
    const pistol = arm(player, 'Pistol');
    const rifle = player.weapons.find(w => w.name === 'Rifle');
    player.ammo.bullets = 60;
    check('the pistol and the rifle read the same bullets', pistol.ammo === 60 && rifle.ammo === 60);
    player.angle = 0;
    player.shoot();
    check('a pistol shot is a bullet the rifle no longer has', pistol.ammo === 59 && rifle.ammo === 59);
    rifle.ammo = 300;
    check('...and the pool stops at 200', pistol.ammo === 200 && player.ammo.bullets === 200);

    const bfg = arm(player, 'BFG');
    player.ammo.cells = 39;
    player.shoot();
    check('thirty-nine cells will not fire the BFG', gs.bullets.length === 0 && player.ammo.cells === 39);
    player.shootCooldown = 0;
    player.ammo.cells = 40;
    player.shoot();
    check('forty will, and are spent', gs.bullets.length === 1 && bfg.ammo === 0 &&
        player.weapons.find(w => w.name === 'Plasma Gun').ammo === 0);
    const fresh = new Player(centre(20), centre(20));
    check('a new marine starts with fifty bullets', fresh.weapons.find(w => w.name === 'Pistol').ammo === 50 &&
        fresh.weapons.find(w => w.name === 'Shotgun').ammo === 0);
    check('the knife needs nothing', fresh.weapons.find(w => w.name === 'Knife').ammo === Infinity);
}

console.log('[hitscan]');
{
    const player = world();
    const imp = dummy('imp', 26, 20);
    const hp = imp.health;
    arm(player, 'Pistol');
    player.angle = 0;
    player.aimX = imp.x; player.aimY = imp.y;
    player.refireCount = 0;
    player.shoot();
    check('a pistol bullet lands the instant it is fired', imp.health < hp && gs.bullets.length === 0, `${hp} -> ${imp.health}`);
    check('...for 5, 10 or 15', [5, 10, 15].includes(hp - imp.health), `${hp - imp.health}`);
    check('...and leaves a tracer', gs.temporaryVisualEffects.some(e => e.type === 'tracer'));
    check('the monster turns on the shooter', imp.target === player);

    // First shot straight, refire spread: aimed at the edge of a target six tiles off
    let straightHits = 0, refireHits = 0;
    for (let i = 0; i < 60; i++) {
        world();
        const far = dummy('zombieman', 32, 20);
        far.health = 100000;
        const p = gs.player; arm(p, 'Pistol'); p.angle = 0;
        const edge = far.getHitShape();
        p.aimX = far.x; p.aimY = edge.y1 !== undefined ? edge.y1 + 1 : far.y - 2;
        p.refireCount = 0; p.shoot();
        if (far.health < 100000) straightHits++;
        far.health = 100000; p.shootCooldown = 0; p.refireCount = 1; p.shoot();
        if (far.health < 100000) refireHits++;
    }
    check('the first shot is dead straight; holding the trigger spreads the rest', straightHits === 60 && refireHits < 60,
        `${straightHits} / ${refireHits}`);

    const p2 = world();
    const imp2 = dummy('imp', 22, 20);
    imp2.health = 100000;
    arm(p2, 'Shotgun'); p2.angle = 0; p2.aimX = imp2.x; p2.aimY = imp2.y;
    p2.shoot();
    const dealt = 100000 - imp2.health;
    check('a shotgun shell at point blank is seven pellets of 5-15', dealt >= 35 && dealt <= 105 && dealt % 5 === 0, `${dealt}`);
    check('...spending one shell', p2.ammo.shells === AMMO_TYPES.shells.max - 1);

    const p3 = world();
    const wall = dummy('imp', 30, 20);
    gs.gameMap[20][25] = TILE_WALL;
    const before = wall.health;
    arm(p3, 'Rifle'); p3.angle = 0; p3.aimX = wall.x; p3.aimY = wall.y;
    p3.refireCount = 3;
    p3.shoot();
    check('a wall stops a bullet', wall.health === before);
    check('...with a puff where it hit', gs.temporaryVisualEffects.some(e => e.type === 'tracer' && e.endX < centre(25) + T));

    // Barrels and switches
    const p4 = world();
    const barrel = new Barrel(centre(24), centre(20));
    gs.barrels.push(barrel);
    arm(p4, 'Pistol'); p4.angle = 0; p4.aimX = barrel.x; p4.aimY = barrel.y; p4.refireCount = 0;
    p4.shoot();
    check('a bullet hits a barrel', barrel.health < barrel.maxHealth);
    gs.gameMap[20][30] = TILE_SWITCH;
    registerSwitches({ slides: [], switches: [{ c: 30, r: 20, face: 'W', room: 0, effect: { kind: 'slide', slide: 0 } }] });
    barrel.isDead = true; gs.barrels = [];
    p4.shootCooldown = 0; p4.refireCount = 0; p4.aimX = centre(30); p4.aimY = centre(20);
    p4.shoot();
    check('a bullet throws a switch', switchAtTile(30, 20).on);

    // Rate
    const p5 = world();
    arm(p5, 'Rifle'); p5.angle = 0;
    p5.ammo.bullets = 200;
    mouse.down = true;
    frames(70);
    mouse.down = false;
    const fired = 200 - p5.ammo.bullets;
    check('the rifle fires a round every 4 tics: ten in 70 frames', fired === 10, `${fired}`);
}

console.log('[the blast]');
{
    const player = world();
    const near = dummy('imp', 24, 20);       // 1 tile from the burst
    const edge = dummy('imp', 26, 20);       // 3 tiles: past the edge, nothing
    const behind = dummy('imp', 23, 22);
    gs.gameMap[21][23] = TILE_WALL;          // ...a wall between it and the burst
    near.health = edge.health = behind.health = 100000;
    player.x = centre(21); player.y = centre(20);
    player.health = 100000;
    const blast = new Explosion(centre(23), centre(20), 128 * DOOM_PX, 30, 'orange', 128, true);
    gs.explosions.push(blast);
    frames(12);
    const nearDealt = 100000 - near.health;
    check('the blast does 128 less the distance to the edge of the thing',
        nearDealt > 0 && nearDealt < 128 && Math.abs(nearDealt - 128 * (1 - (T - near.radius) / (128 * DOOM_PX))) < 1,
        `${nearDealt.toFixed(1)}`);
    check('nothing past the edge of the blast', edge.health === 100000);
    check('nothing through a wall', behind.health === 100000);
    check('the shooter takes their own blast in full', 100000 - player.health > 0 &&
        Math.abs((100000 - player.health) - 128 * (1 - (2 * T - player.radius) / (128 * DOOM_PX))) < 1,
        `${(100000 - player.health).toFixed(1)}`);

    // A rocket does its impact damage and then the blast
    const p2 = world();
    const target = dummy('imp', 24, 20);
    target.health = 100000;
    const rocket = new Bullet(centre(23), centre(20), 0, 7, 'player', 100, 'orange', true, 128 * DOOM_PX, 30);
    rocket.splashDamage = 128;
    gs.bullets.push(rocket);
    aimEast();
    frames(6);                                // 40px at 7px a frame, less the imp's half-width
    check('a rocket does its impact damage on the thing it hits', 100000 - target.health === 100, `${100000 - target.health}`);
    frames(12);
    check('...and then the blast on top', target.health < 100000 - 100, `${100000 - target.health}`);
}

console.log('[the BFG]');
{
    const player = world();
    player.angle = 0;
    const inFan = [dummy('imp', 26, 20), dummy('imp', 26, 22), dummy('imp', 26, 18)];
    const outside = dummy('imp', 14, 20);   // behind the player
    for (const e of [...inFan, outside]) e.health = 100000;
    arm(player, 'BFG');
    player.ammo.cells = 300;
    player.aimX = centre(40); player.aimY = centre(20);
    player.shoot();
    const ball = gs.bullets[0];
    check('the ball leaves at 25 units a tic', ball && ball.isBFGMainProjectile && Math.abs(Math.hypot(ball.dx, ball.dy) - 25 * DOOM_PX / FRAMES_PER_TIC) < 1e-6);
    aimEast();
    let rays = 0;
    for (let i = 0; i < 60 && gs.bullets.length > 0; i++) {
        frames(1);
        rays = Math.max(rays, gs.temporaryVisualEffects.filter(e => e.type === 'bfg_tracer').length);
    }
    check('when it bursts, the fan sprays from the player and hits the monsters in front', inFan.every(e => e.health < 100000) && rays > 0, `${rays} rays`);
    check('...several rays each', inFan.some(e => 100000 - e.health > 120));
    check('...and nothing behind the player', outside.health === 100000);
    check('the ball itself did 100-800 to what it struck',
        inFan.some(e => (100000 - e.health) >= 100), inFan.map(e => 100000 - e.health).join('/'));
    check('every ray is 15-120', inFan.every(e => (100000 - e.health) % 5 === 0));
}

console.log('[projectile scale]');
{
    // The player's projectiles are Doom's too: MT_ROCKET collides at 11 map
    // units, MT_PLASMA and MT_BFG at 13.
    const unit = T / 64;
    const W = WEAPON_STATS;
    check("rocket, plasma and BFG carry Doom's radii",
        Math.abs(W['Rocket Launcher'].bulletRadius - 11 * unit) < 1e-9 &&
        Math.abs(W['Plasma Gun'].bulletRadius - 13 * unit) < 1e-9 &&
        Math.abs(W.BFG.bulletRadius - 13 * unit) < 1e-9);

    const player = world();
    player.angle = 0;
    player.aimX = player.x + 400; player.aimY = player.y;
    const fired = {};
    for (const name of ['Rocket Launcher', 'Plasma Gun', 'BFG']) {
        gs.bullets.length = 0;
        arm(player, name);
        player.ammo.rockets = 50; player.ammo.cells = 300;
        player.shoot();
        fired[name] = gs.bullets[0].radius;
    }
    check('a fired shot carries it into the world',
        Math.abs(fired['Rocket Launcher'] - 11 * unit) < 1e-9 &&
        Math.abs(fired['Plasma Gun'] - 13 * unit) < 1e-9 &&
        Math.abs(fired.BFG - 13 * unit) < 1e-9,
        Object.values(fired).map(v => v.toFixed(2)).join(' / '));
    check('a rocket is smaller than the marine it is fired past',
        fired['Rocket Launcher'] * 2 < player.radius * 2,
        `${(fired['Rocket Launcher'] * 2).toFixed(1)}px vs ${(player.radius * 2).toFixed(1)}px`);
}

console.log('[the fist]');
{
    const player = world();
    const imp = dummy('imp', 21, 20);
    imp.health = 100000;
    arm(player, 'Knife'); player.angle = 0;
    player.shoot();
    const dealt = 100000 - imp.health;
    check('a punch does 2-20', dealt >= 2 && dealt <= 20 && dealt % 2 === 0, `${dealt}`);
}

console.log('');
if (failures === 0) {
    console.log('All arsenal checks passed.');
} else {
    console.log(`${failures} arsenal check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
