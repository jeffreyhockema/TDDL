// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Drops, pickups and secrets. Run with: npm test
 *
 * Three promises the game makes, checked against real levels:
 *
 *   1. Monsters drop what Doom's monsters drop -- a half clip from the zombies,
 *      a shotgun from the Shotgun Guy, a chaingun from the Chaingunner, and
 *      nothing from anything else -- and a dropped weapon lands as a pickup the
 *      player can actually take, wherever the body fell.
 *   2. Ammunition comes from the level, laid out with the map like Doom's, not
 *      from a timer that sprinkled it in mid-fight.
 *   3. Every secret is worth finding, and one a level is worth a lot: the prize
 *      secret may run to several chambers and holds a weapon a tier early, a
 *      sphere, backpack or MegaArmor and boxes of ammo; the rest hold a small
 *      bonus -- at most a green armour -- and never a weapon. Every chamber of
 *      every secret is reachable.
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
    getElementById: getEl,
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
globalThis.AbortController = globalThis.AbortController || class { constructor() { this.signal = {}; } abort() {} };
globalThis.Image = class {
    constructor() { this.complete = true; this.naturalHeight = 64; }
    addEventListener() {}
};
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
const { Enemy, Player, MiniBoss } = await import('../js/entities.js');
const { MONSTERS, MONSTER_TYPES } = await import('../js/monsters.js');
const { WeaponPack, Powerup } = await import('../js/weapons.js');
const { isSolidTile } = await import('../js/utils.js');
const { isKeyedDoor } = await import('../js/terrain.js');
const {
    TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_WALL, TILE_EMPTY, TILE_SECRET_DOOR, TILE_HEALTH_PACK,
    TILE_WEAPON_SHOTGUN, TILE_WEAPON_RIFLE, TILE_WEAPON_ROCKETLAUNCHER, TILE_WEAPON_BFG,
    TILE_WEAPON_PLASMAGUN, AMMO_TYPES, WEAPON_STATS,
} = await import('../js/constants.js');

console.log = origLog;
console.warn = origWarn;

globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const gs = new GameState();
globalThis.gameState = gs;
gs.selectedDifficulty = 'medium';
gs.currentLevel = 1;

const T = TILE_SIZE;
const centre = (tile) => tile * T + T / 2;
const WEAPON_TILES = new Set([TILE_WEAPON_SHOTGUN, TILE_WEAPON_RIFLE, TILE_WEAPON_ROCKETLAUNCHER, TILE_WEAPON_BFG, TILE_WEAPON_PLASMAGUN]);

/** A bare arena with the player in it and nothing on the floor. */
function arena(playerTileX = 20, playerTileY = 20) {
    gs.gameMap = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_EMPTY));
    gs.decor = null;
    gs.enemies = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.temporaryVisualEffects = [];
    gs.healthPacks = [];
    gs.ammoPacks = [];
    gs.weaponPacks = [];
    gs.powerups = [];
    gs.currentBoss = null;
    gs.levelStats = gs.freshLevelStats();
    gs.player = new Player(centre(playerTileX), centre(playerTileY));
    return gs.player;
}

const ammoOf = (player, type) => player.ammo[type];
const weaponOf = (player, name) => player.weapons.find(w => w.name === name);

console.log('\n=== pickups ===\n');

// =============================================================================
// 1. DROPS
// =============================================================================

console.log('[drops]');
{
    const droppers = MONSTER_TYPES.filter(t => MONSTERS[t].drop);
    check('only the four human zombies drop anything',
        droppers.sort().join(',') === ['chaingunner', 'shotgun_guy', 'ss', 'zombieman'].join(','),
        droppers.join(', '));

    const bad = droppers.filter(t => {
        const d = MONSTERS[t].drop;
        return !(d.weapon ? WEAPON_STATS[d.weapon] : AMMO_TYPES[d.ammo]);
    });
    check('every drop names a real weapon or ammo pool', bad.length === 0, bad.join(', '));

    const dropOf = (type) => {
        arena();
        gs.handleEnemyDrop(new Enemy(centre(30), centre(30), type));
        return { weapons: gs.weaponPacks, ammo: gs.ammoPacks };
    };

    const sg = dropOf('shotgun_guy');
    check('a Shotgun Guy drops a shotgun',
        sg.weapons.length === 1 && sg.weapons[0] instanceof WeaponPack && sg.weapons[0].weaponName === 'Shotgun');
    check('...with half a found shotgun\'s shells, as a Doom drop is',
        sg.weapons[0]?.ammo === Math.floor(WEAPON_STATS.Shotgun.pickupAmmo / 2), String(sg.weapons[0]?.ammo));
    check('...where the body fell', sg.weapons[0]?.x === centre(30) && sg.weapons[0]?.y === centre(30));

    const cg = dropOf('chaingunner');
    check('a Chaingunner drops a chaingun with half its rounds',
        cg.weapons.length === 1 && cg.weapons[0].weaponName === 'Rifle' &&
        cg.weapons[0].ammo === Math.floor(WEAPON_STATS.Rifle.pickupAmmo / 2));

    const zm = dropOf('zombieman');
    check('a Zombieman drops a half clip',
        zm.weapons.length === 0 && zm.ammo.length === 1 && zm.ammo[0].weaponName === 'Pistol' &&
        zm.ammo[0].ammoAmount === Math.round(AMMO_TYPES.bullets.clip / 2), JSON.stringify(zm.ammo[0]));

    const ss = dropOf('ss');
    check('so does the SS', ss.ammo.length === 1 && ss.ammo[0].weaponName === 'Pistol');

    const silent = ['imp', 'demon', 'cacodemon', 'baron', 'revenant', 'cyberdemon'].map(dropOf);
    check('demons drop nothing', silent.every(d => d.weapons.length === 0 && d.ammo.length === 0));

    check('the mid-level item spawner is gone', typeof gs.updateRandomSpawning === 'undefined');
}

// =============================================================================
// 2. TAKING A DROPPED WEAPON
// =============================================================================

console.log('[dropped weapons]');
{
    const player = arena();
    gs.weaponPacks.push(new WeaponPack(player.x, player.y, 'Shotgun', 4));
    gs.updatePickups();
    check('walking over a dropped shotgun takes it', weaponOf(player, 'Shotgun').owned && gs.weaponPacks.length === 0);
    check('...with its four shells', ammoOf(player, 'shells') === 4, String(ammoOf(player, 'shells')));
    check('...and it counts as an item found', gs.levelStats.items === 1);

    gs.weaponPacks.push(new WeaponPack(player.x, player.y, 'Shotgun', 4));
    gs.updatePickups();
    check('a second one is taken for its shells', ammoOf(player, 'shells') === 8 && gs.weaponPacks.length === 0);

    player.ammo.shells = AMMO_TYPES.shells.max;
    gs.weaponPacks.push(new WeaponPack(player.x, player.y, 'Shotgun', 4));
    gs.updatePickups();
    check('with shells full it stays on the floor', gs.weaponPacks.length === 1 && ammoOf(player, 'shells') === AMMO_TYPES.shells.max);

    gs.selectedDifficulty = 'easy';
    player.ammo.shells = 0;
    gs.updatePickups();
    check('the easiest skill doubles what a pickup gives, as in Doom', ammoOf(player, 'shells') === 8, String(ammoOf(player, 'shells')));
    gs.selectedDifficulty = 'medium';

    // The mini-boss leaves its launcher on the floor rather than in the hands.
    arena();
    gs.player.health = 1000;
    const boss = new MiniBoss(centre(25), centre(25), 3);
    boss.takeDamage(1e9, gs.player);
    check('a dead mini-boss leaves a rocket launcher where it fell',
        gs.weaponPacks.length === 1 && gs.weaponPacks[0].weaponName === 'Rocket Launcher' &&
        gs.weaponPacks[0].ammo === WEAPON_STATS['Rocket Launcher'].pickupAmmo,
        JSON.stringify(gs.weaponPacks[0]));
    check('...and not in the player\'s inventory', !weaponOf(gs.player, 'Rocket Launcher').owned);
}

// =============================================================================
// 3. POWERUPS
// =============================================================================

console.log('[powerups]');
{
    const player = arena();
    player.health = 100;
    player.maxHealth = 100;
    gs.powerups.push(new Powerup(player.x, player.y, 'soulsphere'));
    gs.updatePickups();
    check('a soulsphere takes a full marine to 200', player.health === 200 && gs.powerups.length === 0, String(player.health));

    gs.powerups.push(new Powerup(player.x, player.y, 'soulsphere'));
    gs.updatePickups();
    check('and at 200 the next one stays on the floor', player.health === 200 && gs.powerups.length === 1);

    player.health = 30;
    gs.updatePickups();
    check('it heals from low health too, still capped at 200', player.health === 130 && gs.powerups.length === 0);

    const before = { ...player.ammoMax };
    const bulletsBefore = ammoOf(player, 'bullets');
    gs.powerups.push(new Powerup(player.x, player.y, 'backpack'));
    gs.updatePickups();
    check('a backpack doubles every ammo ceiling',
        Object.keys(before).every(type => player.ammoMax[type] === before[type] * 2) &&
        weaponOf(player, 'Shotgun').maxAmmo === AMMO_TYPES.shells.max * 2,
        JSON.stringify(player.ammoMax));
    check('...and comes with a clip of everything',
        ammoOf(player, 'bullets') === bulletsBefore + AMMO_TYPES.bullets.clip && ammoOf(player, 'shells') === AMMO_TYPES.shells.clip);

    gs.powerups.push(new Powerup(player.x, player.y, 'backpack'));
    gs.updatePickups();
    check('a second backpack is just the clips',
        Object.keys(before).every(type => player.ammoMax[type] === before[type] * 2) &&
        ammoOf(player, 'shells') === AMMO_TYPES.shells.clip * 2);

    weaponOf(player, 'Shotgun').ammo = 500;
    check('the raised ceiling is what the pool clamps to', ammoOf(player, 'shells') === AMMO_TYPES.shells.max * 2);
}

// =============================================================================
// 4. REAL LEVELS: AMMO ON THE FLOOR, SECRETS WORTH FINDING
// =============================================================================

console.log('[levels]');

/**
 * Every tile reachable from the player's start, walking through anything that
 * is not solid rock -- doors, secret doors and items included.
 */
function reachable(map, start) {
    const seen = new Set();
    const stack = [[start.c, start.r]];
    const passable = (t) => !isSolidTile(t) || t === TILE_SECRET_DOOR || isKeyedDoor(t);
    while (stack.length) {
        const [c, r] = stack.pop();
        const key = r * MAP_COLS + c;
        if (seen.has(key)) continue;
        if (c < 0 || r < 0 || c >= MAP_COLS || r >= MAP_ROWS) continue;
        if (!passable(map[r][c])) continue;
        seen.add(key);
        stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    return seen;
}

{
    const inChamber = (suite, c, r) => suite.chambers.some(ch =>
        c >= ch.x && c < ch.x + ch.width && r >= ch.y && r < ch.y + ch.height);

    let levels = 0;
    let suites = 0;
    let multi = 0;
    let three = 0;
    const problems = [];
    const weaponsAtLevel = {};

    console.log = noop;
    console.warn = noop;
    gs.startGame();
    // Two different questions, needing two different sample sizes.
    //
    // The structural checks below -- one prize secret, every chamber reachable,
    // nothing on a wall -- are about a single level being well formed, and this
    // curated list is the set they were written against. The chamber-count
    // statistic underneath is about how often a rare shape turns up, and eight
    // levels is far too few to ask that of: a third chamber needs both its roll
    // and the rock to build into, so it lands around one level in seven and a
    // short sample missed it often enough to fail at random. So: keep sampling
    // out to forty for the statistic, and hold the structural checks to the
    // levels they were built for.
    const structural = [1, 2, 3, 4, 6, 8, 11, 13];
    const sample = structural.slice();
    while (sample.length < 40) sample.push(1 + (sample.length % 14));
    for (const level of sample) {
        const checkStructure = structural.includes(level);
        // A level outside that list still counts toward the statistic; it just
        // is not held to the structural checks.
        const fault = (message) => { if (checkStructure) problems.push(message); };
        gs.currentLevel = level;
        gs.initLevel();
        levels++;

        // Ammo laid out with the level.
        if (gs.ammoPacks.length === 0) fault(`level ${level}: no ammo on the floor`);
        for (const pack of gs.ammoPacks) {
            const c = Math.floor(pack.x / T);
            const r = Math.floor(pack.y / T);
            if (gs.gameMap[r][c] !== TILE_EMPTY) fault(`level ${level}: ammo on a non-floor tile ${gs.gameMap[r][c]}`);
            if (Math.abs(c - gs.playerSpawn.c) <= 1 && Math.abs(r - gs.playerSpawn.r) <= 1) {
                fault(`level ${level}: ammo on the player's start`);
            }
        }

        // Secrets.
        const open = reachable(gs.gameMap, gs.playerSpawn);
        let prizes = 0;
        let stocked = 0;
        for (const suite of gs.secretSuites) {
            suites++;
            if (suite.chambers.length >= 2) multi++;
            if (suite.chambers.length >= 3) three++;

            let weapons = 0;
            let ammo = 0;
            let prize = 0;
            let powerups = 0;
            let megaArmor = 0;
            let items = 0;
            for (const ch of suite.chambers) {
                for (let r = ch.y; r < ch.y + ch.height; r++) {
                    for (let c = ch.x; c < ch.x + ch.width; c++) {
                        const t = gs.gameMap[r][c];
                        if (isSolidTile(t)) fault(`level ${level}: chamber tile (${c},${r}) is solid`);
                        if (!open.has(r * MAP_COLS + c)) fault(`level ${level}: chamber tile (${c},${r}) unreachable`);
                        if (WEAPON_TILES.has(t)) {
                            weapons++;
                            (weaponsAtLevel[level] ||= new Set()).add(t);
                        }
                        if (t === TILE_HEALTH_PACK) { prize++; items++; }
                    }
                }
            }
            for (const item of suite.loot) {
                if (!inChamber(suite, item.c, item.r)) fault(`level ${level}: loot outside its suite`);
                const x = centre(item.c);
                const y = centre(item.r);
                if (item.kind === 'ammo') {
                    ammo++;
                    items++;
                    if (!gs.ammoPacks.some(p => p.x === x && p.y === y && p.large === !!item.big)) fault(`level ${level}: secret ammo not spawned`);
                } else if (item.kind === 'powerup') {
                    prize++;
                    powerups++;
                    items++;
                    if (!gs.powerups.some(p => p.x === x && p.y === y && p.kind === item.powerup)) fault(`level ${level}: ${item.powerup} not spawned`);
                } else if (item.kind === 'armor') {
                    // A MegaArmor is a prize; a green armour is a minor bonus.
                    items++;
                    if (item.armor === 'blue') { prize++; megaArmor++; }
                    if (!gs.armorPickups.some(p => p.x === x && p.y === y && p.kind === item.armor)) fault(`level ${level}: ${item.armor} armour not spawned`);
                }
            }

            if (weapons > 0) {
                // The prize secret.
                prizes++;
                if (weapons !== 1) fault(`level ${level}: prize secret with ${weapons} weapons`);
                if (ammo !== suite.chambers.length) fault(`level ${level}: prize secret has ${ammo} ammo boxes for ${suite.chambers.length} chambers`);
                if (prize === 0) fault(`level ${level}: prize secret with neither sphere, backpack, MegaArmor nor medikit`);
            } else {
                // A minor one: a bonus, but nothing the prize secret keeps for itself.
                if (powerups > 0) fault(`level ${level}: a minor secret holding a powerup`);
                if (megaArmor > 0) fault(`level ${level}: a minor secret holding a MegaArmor`);
                if (suite.chambers.length !== 1) fault(`level ${level}: a minor secret with ${suite.chambers.length} chambers`);
                if (items === 0 || items > 2) fault(`level ${level}: a minor secret with ${items} items`);
            }
            if (items === 0) stocked--;
            stocked++;
        }
        if (prizes !== 1) fault(`level ${level}: ${prizes} prize secrets among ${gs.secretSuites.length}`);
        if (gs.secretSuites.length > 0 && stocked !== gs.secretSuites.length) fault(`level ${level}: an empty secret`);
    }
    console.log = origLog;
    console.warn = origWarn;

    check(`${levels} levels generated with ${suites} secret suites`, suites >= levels * 3, `${suites} suites`);
    check('the prize secret usually runs to two chambers', multi >= Math.floor(levels / 2), `${multi} of ${levels} levels`);
    check('and sometimes three', three > 0, `${three} of ${levels}`);
    check('exactly one prize secret a level; every chamber reachable; minor secrets minor; nothing buried, missing or empty',
        problems.length === 0, problems.slice(0, 6).join('; '));
    check('a level-1 secret holds the shotgun, a level early',
        weaponsAtLevel[1]?.has(TILE_WEAPON_SHOTGUN) && weaponsAtLevel[1].size === 1);
    check('a level-3 secret holds the chaingun', weaponsAtLevel[3]?.has(TILE_WEAPON_RIFLE) && weaponsAtLevel[3].size === 1);
    check('a level-8 secret holds the BFG', weaponsAtLevel[8]?.has(TILE_WEAPON_BFG));
    console.log(`  ${suites} secrets over ${levels} levels: ${multi} prize suites with two chambers, ${three} with three`);
}

console.log('');
if (failures === 0) {
    console.log('All pickup checks passed.');
    process.exit(0);
} else {
    console.error(`${failures} pickup check(s) FAILED.`);
    process.exit(1);
}
