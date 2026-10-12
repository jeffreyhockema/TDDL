// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Armour. Run with: npm test
 *
 * Doom's armour, checked against the real Player and GameState:
 *
 *   1. Absorption. P_DamageMobj's rule, exactly: green armour takes a third
 *      of a hit and blue half, rounded down, spent point for point; the class
 *      goes with the last point. The skill's halving comes first. Monster
 *      hits and blasts go through it, and so does a hazardous floor, split at
 *      the class's ratio. God mode and invulnerability stop the hit before
 *      the armour is touched.
 *   2. Pickups. Green sets 100 and is refused at 100 or more; blue sets 200
 *      and is refused at 200; a bonus is +1 up to 200, always taken, and
 *      starts class 1. The megasphere is health 200 and a MegaArmor. Every
 *      one taken counts in the level tally.
 *   3. Persistence. Armour carries from level to level and a new game starts
 *      with none.
 *   4. IDKFA and IDFA hand over 200 points of blue, as Doom's do.
 *   5. Placement. Generated levels hold armour -- green from level 1, rows of
 *      bonuses, the MegaArmor late or in the prize secret -- on bare floor,
 *      never on or beside the start square.
 *   6. The HUD readout shows the points and the class's colour, and the
 *      player remembers each hit for the status bar's face.
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

/** A class list that remembers, so the HUD's colour classes can be read back. */
function makeClassList() {
    const set = new Set();
    return {
        add: (...names) => names.forEach(n => set.add(n)),
        remove: (...names) => names.forEach(n => set.delete(n)),
        toggle: (name, force) => {
            const on = force === undefined ? !set.has(name) : !!force;
            if (on) set.add(name); else set.delete(name);
            return on;
        },
        contains: (name) => set.has(name),
    };
}

function makeElement(id) {
    return {
        id, style: {}, dataset: {}, textContent: '', innerHTML: '',
        width: 1200, height: 800, complete: true, naturalHeight: 64,
        classList: makeClassList(),
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
const { Enemy, Player } = await import('../js/entities.js');
const { ArmorPickup, Powerup, ARMOR_PICKUPS } = await import('../js/weapons.js');
const { CheatMatcher, applyCheat } = await import('../js/cheats.js');
const { getTerrain } = await import('../js/terrain.js');
const {
    TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_TOXIC, ARMOR, ANIMATION_TICKS_PER_SECOND,
    TILE_WEAPON_SHOTGUN, TILE_WEAPON_RIFLE, TILE_WEAPON_ROCKETLAUNCHER, TILE_WEAPON_BFG, TILE_WEAPON_PLASMAGUN,
} = await import('../js/constants.js');

console.log = origLog;
console.warn = origWarn;

globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const gs = new GameState();
globalThis.gameState = gs;
gs.selectedDifficulty = 'medium';
gs.currentLevel = 1;

const T = TILE_SIZE;
const WEAPON_TILES = new Set([TILE_WEAPON_SHOTGUN, TILE_WEAPON_RIFLE, TILE_WEAPON_ROCKETLAUNCHER, TILE_WEAPON_BFG, TILE_WEAPON_PLASMAGUN]);
const centre = (tile) => tile * T + T / 2;

/** A bare arena with a fresh player in it and nothing on the floor. */
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
    gs.armorPickups = [];
    gs.currentBoss = null;
    gs.levelStats = gs.freshLevelStats();
    gs.player = new Player(centre(playerTileX), centre(playerTileY));
    return gs.player;
}

/** A player wearing the given armour, at full health. */
function wearing(points, armorClass) {
    const player = arena();
    player.health = 100;
    player.armor = points;
    player.armorClass = armorClass;
    return player;
}

console.log('\n=== armor ===\n');

// =============================================================================
// 1. ABSORPTION
// =============================================================================

console.log('[absorption]');
{
    const fresh = arena();
    check('a new marine has no armour', fresh.armor === 0 && fresh.armorClass === 0);
    fresh.health = 100;
    fresh.takeDamage(30);
    check('...and takes a hit in full', fresh.health === 70, String(fresh.health));

    let p = wearing(100, 1);
    p.takeDamage(30);
    check('green armour takes a third: 30 is 20 to health, 10 to armour',
        p.health === 80 && p.armor === 90 && p.armorClass === 1, `${p.health} / ${p.armor}`);

    p = wearing(100, 1);
    p.takeDamage(10);
    check('...rounded down, as Doom\'s integer maths does: 10 is 7 and 3',
        p.health === 93 && p.armor === 97, `${p.health} / ${p.armor}`);

    p = wearing(100, 1);
    p.takeDamage(2);
    check('...so a hit of 2 saves nothing', p.health === 98 && p.armor === 100);

    p = wearing(200, 2);
    p.takeDamage(25);
    check('blue armour takes half: 25 is 13 to health, 12 to armour',
        p.health === 87 && p.armor === 188 && p.armorClass === 2, `${p.health} / ${p.armor}`);

    p = wearing(5, 1);
    p.takeDamage(30);
    check('armour short of its share gives what it has: 5 of the 10, then 25 lands',
        p.health === 75 && p.armor === 0, `${p.health} / ${p.armor}`);
    check('...and the class goes with the last point', p.armorClass === 0);
    p.takeDamage(30);
    check('...so the next hit lands in full', p.health === 45 && p.armor === 0, String(p.health));

    p = wearing(10, 2);
    p.takeDamage(20);
    check('armour exactly equal to its share is spent and the class dropped too',
        p.health === 90 && p.armor === 0 && p.armorClass === 0, `${p.health} / ${p.armor} / ${p.armorClass}`);

    gs.selectedDifficulty = 'easy';
    p = wearing(100, 1);
    p.takeDamage(30);
    check('on the easiest skill the halving comes first: 30 is 15, then 5 to armour',
        p.health === 90 && p.armor === 95, `${p.health} / ${p.armor}`);
    gs.selectedDifficulty = 'medium';

    // A monster's hit reaches the player through the same door.
    p = wearing(100, 1);
    const imp = new Enemy(centre(22), centre(20), 'imp');
    imp.dealDamage(p, 24);
    check('a monster\'s hit is absorbed the same way', p.health === 84 && p.armor === 92,
        `${p.health} / ${p.armor}`);
}

console.log('[hazardous floors]');
{
    const frames = ANIMATION_TICKS_PER_SECOND * 3;
    const wade = (points, armorClass) => {
        const p = wearing(points, armorClass);
        gs.gameMap[20][20] = TILE_TOXIC;
        for (let i = 0; i < frames; i++) p.applyTerrainEffects();
        return p;
    };

    const rate = getTerrain(TILE_TOXIC).damagePerSecond;
    const bare = wade(0, 0);
    const bareLoss = 100 - bare.health;
    check(`toxic waste does its ${rate}/s to a marine with no armour`,
        Math.abs(bareLoss - rate * 3) <= 1, String(bareLoss));

    const green = wade(100, 1);
    const greenLoss = 100 - green.health;
    const greenSpent = 100 - green.armor;
    check('green armour takes a third of the floor\'s damage too',
        Math.abs(greenLoss - rate * 3 * 2 / 3) <= 1 && Math.abs(greenSpent - rate * 3 / 3) <= 1,
        `health -${greenLoss}, armour -${greenSpent}`);

    const blue = wade(200, 2);
    check('blue armour half of it',
        Math.abs((100 - blue.health) - rate * 3 / 2) <= 1 && Math.abs((200 - blue.armor) - rate * 3 / 2) <= 1,
        `health -${100 - blue.health}, armour -${200 - blue.armor}`);
    check('armour points stay whole numbers on the floor', Number.isInteger(blue.armor) && Number.isInteger(green.armor));

    const thin = wade(2, 1);
    check('a floor wears armour out and drops its class', thin.armor === 0 && thin.armorClass === 0,
        `${thin.armor} / ${thin.armorClass}`);
}

console.log('[god mode and invulnerability]');
{
    let p = wearing(100, 1);
    p.godMode = true;
    p.takeDamage(50);
    check('god mode: no health lost and no armour spent', p.health === 100 && p.armor === 100);

    p = wearing(200, 2);
    p.givePower('invulnerability');
    p.takeDamage(80);
    check('invulnerability: the same', p.health === 100 && p.armor === 200);

    p = wearing(100, 1);
    p.godMode = true;
    gs.gameMap[20][20] = TILE_TOXIC;
    for (let i = 0; i < ANIMATION_TICKS_PER_SECOND * 2; i++) p.applyTerrainEffects();
    check('and a hazardous floor wears none of it away either', p.health === 100 && p.armor === 100);
}

// =============================================================================
// 2. PICKUPS
// =============================================================================

console.log('[pickups]');
{
    /** Drops an item on the player, runs the pickup pass, reports if it was taken. */
    const offer = (player, kind) => {
        const item = new ArmorPickup(player.x, player.y, kind);
        gs.armorPickups.push(item);
        gs.updatePickups();
        const taken = !gs.armorPickups.includes(item);
        gs.armorPickups = gs.armorPickups.filter(i => i !== item);
        return taken;
    };

    let p = arena();
    check('a green armour is taken with no armour on', offer(p, 'green'));
    check('...and sets 100 points of class 1', p.armor === 100 && p.armorClass === 1);
    check('...and counts as an item found', gs.levelStats.items === 1, String(gs.levelStats.items));
    check('a second at 100 stays on the floor', !offer(p, 'green') && p.armor === 100);
    check('...and is not counted', gs.levelStats.items === 1);

    p = wearing(150, 2);
    check('green is refused at 150 of blue as well', !offer(p, 'green') && p.armor === 150 && p.armorClass === 2);

    p = wearing(60, 2);
    check('at 60 of blue a green is taken, and the points SET to 100 of green, as Doom does',
        offer(p, 'green') && p.armor === 100 && p.armorClass === 1, `${p.armor} / ${p.armorClass}`);

    p = wearing(100, 1);
    check('a MegaArmor is taken over 100 of green', offer(p, 'blue'));
    check('...and sets 200 points of class 2', p.armor === 200 && p.armorClass === 2);
    p.armor = 199;
    check('a MegaArmor is taken at 199', offer(p, 'blue') && p.armor === 200);
    check('...and refused at 200', !offer(p, 'blue') && p.armor === 200);

    p = arena();
    check('an armour bonus is taken with no armour on', offer(p, 'bonus'));
    check('...giving 1 point and class 1', p.armor === 1 && p.armorClass === 1, `${p.armor} / ${p.armorClass}`);

    p = wearing(50, 2);
    offer(p, 'bonus');
    check('a bonus over blue adds a point and keeps class 2', p.armor === 51 && p.armorClass === 2);

    p = wearing(200, 2);
    check('a bonus at 200 is still taken, as in Doom', offer(p, 'bonus'));
    check('...but the points stay at 200', p.armor === ARMOR.MAX && p.armor === 200);
    p.armor = 199;
    offer(p, 'bonus');
    offer(p, 'bonus');
    check('bonuses cap at 200', p.armor === 200);

    // The pickup radius is the item's own, as for every other pickup.
    p = arena();
    const far = new ArmorPickup(p.x + T * 3, p.y, 'green');
    gs.armorPickups.push(far);
    gs.updatePickups();
    check('armour across the room is left alone', gs.armorPickups.includes(far) && p.armor === 0);

    check('every armour kind has a look', ['green', 'blue', 'bonus'].every(k => ARMOR_PICKUPS[k]));
    check('an unknown kind falls back to green rather than throwing', new ArmorPickup(0, 0, 'mithril').kind === 'green');
    let drew = true;
    try {
        for (const kind of ['green', 'blue', 'bonus']) new ArmorPickup(10, 10, kind).draw(makeCtx());
        new Powerup(10, 10, 'megasphere').draw(makeCtx());
    } catch (error) {
        drew = String(error);
    }
    check('vest, helmet and megasphere all draw', drew === true, String(drew));
}

console.log('[megasphere]');
{
    const p = arena();
    p.health = 40;
    gs.powerups.push(new Powerup(p.x, p.y, 'megasphere'));
    gs.updatePickups();
    check('a megasphere is health 200 and 200 points of blue',
        p.health === 200 && p.armor === 200 && p.armorClass === 2 && gs.powerups.length === 0,
        `${p.health} / ${p.armor} / ${p.armorClass}`);
    check('...and counts as an item', gs.levelStats.items === 1);

    gs.powerups.push(new Powerup(p.x, p.y, 'megasphere'));
    gs.updatePickups();
    check('with nothing left to give it stays on the floor', gs.powerups.length === 1);

    p.armor = 30;
    p.armorClass = 1;
    gs.updatePickups();
    check('at full health it is still taken for the armour', gs.powerups.length === 0 && p.armor === 200 && p.armorClass === 2);
}

// =============================================================================
// 3. PERSISTENCE
// =============================================================================

console.log('[persistence]');
{
    console.log = noop;
    console.warn = noop;
    gs.reset();
    gs.startGame();
    const first = gs.player;
    first.setArmor(150, 2);
    gs.currentLevel = 2;
    gs.initLevel();
    const carried = gs.player === first && gs.player.armor === 150 && gs.player.armorClass === 2;
    gs.currentLevel = 3;
    gs.initLevel();
    const twice = gs.player.armor === 150 && gs.player.armorClass === 2;

    // Dying ends the run; the menu's restart is reset() then startGame().
    gs.player.health = 0;
    gs.reset();
    gs.startGame();
    const restarted = gs.player;
    console.log = origLog;
    console.warn = origWarn;

    check('armour carries to the next level', carried);
    check('...and the one after', twice);
    check('a new game after death starts with none', restarted !== first && restarted.armor === 0 && restarted.armorClass === 0);
    check('the HUD shows the reset too', getEl('armorDisplay').textContent === 0 || getEl('armorDisplay').textContent === '0',
        String(getEl('armorDisplay').textContent));
}

// =============================================================================
// 4. CHEATS
// =============================================================================

console.log('[cheats]');
{
    const type = (word) => {
        const matcher = new CheatMatcher();
        for (const ch of word) {
            const { cheat } = matcher.feed(ch);
            if (cheat) applyCheat(cheat, gs);
        }
    };

    let p = wearing(0, 0);
    type('idkfa');
    check('IDKFA gives 200 points of blue armour', p.armor === 200 && p.armorClass === 2, `${p.armor} / ${p.armorClass}`);

    p = wearing(40, 1);
    type('idfa');
    check('IDFA does too, replacing green', p.armor === 200 && p.armorClass === 2, `${p.armor} / ${p.armorClass}`);
    check('...without the keys', !p.keysCollected.red);
}

// =============================================================================
// 5. PLACEMENT
// =============================================================================

console.log('[placement]');
{
    console.log = noop;
    console.warn = noop;
    gs.reset();
    gs.startGame();

    const problems = [];
    const counts = { green: 0, blue: 0, bonus: 0 };
    let levels = 0;
    let levelOneGreen = 0;
    let levelOnes = 0;
    let earlyBlueInOpen = 0;
    let rowed = 0;
    let prizeBlue = 0;
    let earlyPrizeBlue = 0;
    let megaspheres = 0;
    let earlyMegaspheres = 0;
    let minorBlue = 0;

    const sample = [];
    for (let i = 0; i < 6; i++) sample.push(1);
    for (let level = 2; level <= 14; level++) sample.push(level, level, level, level);
    for (let level = 8; level <= 14; level++) sample.push(level, level, level, level, level);

    for (const level of sample) {
        gs.currentLevel = level;
        gs.initLevel();
        levels++;

        const secretSpots = new Set();
        for (const suite of gs.secretSuites || []) {
            // The prize secret is the one with the weapon in it.
            const prize = suite.chambers.some(ch => {
                for (let r = ch.y; r < ch.y + ch.height; r++) {
                    for (let c = ch.x; c < ch.x + ch.width; c++) {
                        if (WEAPON_TILES.has(gs.gameMap[r][c])) return true;
                    }
                }
                return false;
            });
            for (const item of suite.loot) {
                if (item.kind === 'armor') {
                    secretSpots.add(`${item.c},${item.r}`);
                    if (item.armor === 'blue') {
                        prizeBlue++;
                        if (level < 3) earlyPrizeBlue++;
                        // Only the prize secret holds a MegaArmor.
                        if (!prize) minorBlue++;
                    }
                }
                if (item.kind === 'powerup' && item.powerup === 'megasphere') {
                    megaspheres++;
                    if (level < 8) earlyMegaspheres++;
                }
            }
        }

        const tiles = new Set();
        let green = 0;
        for (const item of gs.armorPickups) {
            const c = Math.floor(item.x / T);
            const r = Math.floor(item.y / T);
            const key = `${c},${r}`;
            const inSecret = secretSpots.has(key);
            if (!inSecret) {
                counts[item.kind]++;
                if (item.kind === 'green') green++;
                if (item.kind === 'blue' && level < 6) earlyBlueInOpen++;
            }
            if (gs.gameMap[r][c] !== TILE_EMPTY) problems.push(`level ${level}: ${item.kind} on tile ${gs.gameMap[r][c]}`);
            if (Math.abs(c - gs.playerSpawn.c) <= 1 && Math.abs(r - gs.playerSpawn.r) <= 1) {
                problems.push(`level ${level}: ${item.kind} on or beside the start square`);
            }
            if (tiles.has(key)) problems.push(`level ${level}: two armour pickups on ${key}`);
            tiles.add(key);
            if (gs.ammoPacks.some(a => Math.floor(a.x / T) === c && Math.floor(a.y / T) === r)) {
                problems.push(`level ${level}: armour on top of ammo at ${key}`);
            }
        }

        // A bonus in a row has another beside it, across or down.
        for (const item of gs.armorPickups) {
            if (item.kind !== 'bonus') continue;
            const c = Math.floor(item.x / T);
            const r = Math.floor(item.y / T);
            if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) =>
                gs.armorPickups.some(o => o.kind === 'bonus' && Math.floor(o.x / T) === c + dc && Math.floor(o.y / T) === r + dr))) {
                rowed++;
            }
        }

        if (level === 1) {
            levelOnes++;
            if (green > 0) levelOneGreen++;
        }
    }
    console.log = origLog;
    console.warn = origWarn;

    check(`${levels} generated levels: armour on bare floor, never on or beside the start, never stacked`,
        problems.length === 0, problems.slice(0, 5).join('; '));
    check('level 1 always has a green armour in the open', levelOneGreen === levelOnes, `${levelOneGreen} of ${levelOnes}`);
    check('green armour is common', counts.green >= levels * 0.4, `${counts.green} over ${levels} levels`);
    check('armour bonuses are laid out', counts.bonus >= levels, `${counts.bonus} over ${levels} levels`);
    check('...in rows, not alone', rowed === counts.bonus, `${rowed} of ${counts.bonus} beside another`);
    check('no MegaArmor in the open before level 6', earlyBlueInOpen === 0, String(earlyBlueInOpen));
    check('the MegaArmor is rare in the open', counts.blue <= levels * 0.3, `${counts.blue} over ${levels} levels`);
    check('...but turns up as a prize-secret find', prizeBlue > 0, String(prizeBlue));
    check('...never before level 3, and never in a minor secret', earlyPrizeBlue === 0 && minorBlue === 0,
        `${earlyPrizeBlue} early, ${minorBlue} minor`);
    check('the megasphere is a late prize: some from level 8, none before', megaspheres > 0 && earlyMegaspheres === 0,
        `${megaspheres} found, ${earlyMegaspheres} early`);
    console.log(`  ${levels} levels: ${counts.green} green, ${counts.blue} blue and ${counts.bonus} bonuses in the open; ` +
        `${prizeBlue} MegaArmors and ${megaspheres} megaspheres in prize secrets`);
}

// =============================================================================
// 6. HUD
// =============================================================================

console.log('[hud]');
{
    const p = arena();
    const value = getEl('armorDisplay');
    const box = getEl('armorDisplayContainer').classList;

    p.setArmor(0, 0);
    check('no armour: 0, dimmed', String(value.textContent) === '0' && box.contains('armor-none') &&
        !box.contains('armor-green') && !box.contains('armor-blue'));

    p.giveArmor(ARMOR.GREEN);
    check('green armour: 100, in green', String(value.textContent) === '100' && box.contains('armor-green') && !box.contains('armor-none'));

    p.giveArmor(ARMOR.BLUE);
    check('blue armour: 200, in blue', String(value.textContent) === '200' && box.contains('armor-blue') && !box.contains('armor-green'));

    p.health = 100;
    p.takeDamage(40);
    check('a hit updates it', String(value.textContent) === '180', String(value.textContent));

    p.setArmor(3, 1);
    p.takeDamage(40);
    check('armour run out goes back to dim', String(value.textContent) === '0' && box.contains('armor-none'));
    // The status bar's face looks towards a hit, so the player remembers it
    const before = p.hitSerial;
    p.health = 100;
    p.takeDamage(5, { x: p.x - 200, y: p.y });
    check('a hit is remembered for the face, with where it came from',
        p.hitSerial === before + 1 && p.hitFrom?.x === p.x - 200);
    p.takeDamage(5);
    check('...and one from nowhere has no source', p.hitSerial === before + 2 && p.hitFrom === null);
    p.godMode = true;
    p.takeDamage(5, { x: 0, y: 0 });
    check('...but god mode turns it away unseen', p.hitSerial === before + 2);
    p.godMode = false;
}

console.log('');
if (failures === 0) {
    console.log('All armor checks passed.');
    process.exit(0);
} else {
    console.error(`${failures} armor check(s) FAILED.`);
    process.exit(1);
}
