// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Doom's cheat codes. Run with: npm test
 *
 * Two halves, as in js/cheats.js:
 *
 *   1. The matcher. Every code is recognised as it is typed, in either case;
 *      IDCLEV takes two digits and IDBEHOLD a letter; a wrong key starts the
 *      sequence over; keys that are not characters are ignored; and only keys
 *      that continue a code already past "ID" are claimed from play -- the "d"
 *      of a stray "id" still strafes.
 *   2. The effects, on a live game. God mode and invulnerability stop every
 *      source of damage and no-clipping stops none; IDKFA and IDFA stock the
 *      arsenal; each power-up toggles and does its job; IDDT cycles the map;
 *      IDCLEV warps; and every reply lands on the message line in Doom's words.
 *      The render path is driven too, against a recording canvas, so the
 *      minimap, the message line and the palette are seen to be drawn.
 */

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

// ---------------------------------------------------------------- canvas stub
/** Records the calls the assertions below care about; swallows the rest. */
function makeRecordingCtx(log, tag) {
    const state = { globalCompositeOperation: 'source-over', globalAlpha: 1 };
    const record = (op) => (...args) => { log.push({ tag, op, args }); };
    const target = {
        get canvas() { return { width: 1200, height: 800 }; },
        fillRect: record('fillRect'),
        fillText: record('fillText'),
        drawImage: record('drawImage'),
        clearRect: record('clearRect'),
        createRadialGradient: () => ({ addColorStop: noop }),
        createConicGradient: () => ({ addColorStop: noop }),
        createLinearGradient: () => ({ addColorStop: noop }),
        measureText: (text) => ({ width: String(text).length * 10 }),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        set fillStyle(v) { state.fillStyle = v; log.push({ tag, op: 'fillStyle', args: [v] }); },
        get fillStyle() { return state.fillStyle; },
        set globalCompositeOperation(v) { state.globalCompositeOperation = v; log.push({ tag, op: 'gco', args: [v] }); },
        get globalCompositeOperation() { return state.globalCompositeOperation; },
        set globalAlpha(v) { state.globalAlpha = v; },
        get globalAlpha() { return state.globalAlpha; },
    };
    // Anything not spelled out above is a no-op method or a writable property
    return new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : (state[prop] ?? noop); },
        set(t, prop, v) {
            const desc = Object.getOwnPropertyDescriptor(t, prop);
            if (desc && desc.set) desc.set(v); else state[prop] = v;
            return true;
        },
    });
}

const drawLog = [];

function makeElement(id) {
    return {
        id, style: {}, dataset: {}, textContent: '', innerHTML: '',
        width: 1200, height: 800, complete: true, naturalHeight: 64,
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        addEventListener: noop, removeEventListener: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
        getContext: () => makeRecordingCtx(drawLog, id),
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
    createElement: () => makeElement('offscreen'),
    addEventListener: noop, removeEventListener: noop, hidden: false,
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.AbortController = class { constructor() { this.signal = {}; } abort() {} };
globalThis.Image = class {
    constructor() { this.complete = true; this.naturalHeight = 64; }
    addEventListener() {}
};
globalThis.fetch = async () => ({ ok: false, status: 404 });

const origLog = console.log;
const origWarn = console.warn;
console.log = noop;
console.warn = noop;

const { CheatMatcher, applyCheat, CHEAT_MESSAGES, BEHOLD_POWERS, cheatsInText } = await import('../js/cheats.js');
const { GameController } = await import('../js/main.js');
const { Player, Enemy } = await import('../js/entities.js');
const { keys } = await import('../js/input-handler.js');
const { shadowAimOffset, ticsToFrames } = await import('../js/monsters.js');
const { updateLighting, getLightMap, resetLighting } = await import('../js/lighting.js');
const { registerSectors, isFullBright } = await import('../js/sectors.js');
const {
    TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL, TILE_LAVA,
    POWER_NAMES, POWER_DURATION_TICS, MINIMAP,
} = await import('../js/constants.js');

console.log = origLog;
console.warn = origWarn;

const centre = (tile) => tile * TILE_SIZE + TILE_SIZE / 2;

/** Types a string into a fresh matcher and returns every cheat it fired. */
function typeAll(text, matcher = new CheatMatcher()) {
    const fired = [];
    const claimed = [];
    for (const ch of text) {
        const { consumed, cheat } = matcher.feed(ch);
        claimed.push(consumed);
        if (cheat) fired.push(cheat);
    }
    return { fired, claimed, matcher };
}

console.log('\n=== cheats ===\n');

// =============================================================================
// 1. MATCHING
// =============================================================================

console.log('[matching]');
{
    const expect = {
        iddqd: 'god', idkfa: 'kfa', idfa: 'fa', idclip: 'noclip', idspispopd: 'noclip',
        idchoppers: 'choppers', iddt: 'map', idmypos: 'mypos',
    };
    const wrong = Object.entries(expect).filter(([code, id]) => {
        const { fired } = typeAll(code);
        return fired.length !== 1 || fired[0].id !== id;
    });
    check('every plain code fires exactly its cheat', wrong.length === 0, wrong.map(w => w[0]).join(', '));

    const upper = typeAll('IDDQD').fired;
    check('codes are case-insensitive', upper.length === 1 && upper[0].id === 'god');
    const mixed = typeAll('IdKfA').fired;
    check('mixed case works too', mixed.length === 1 && mixed[0].id === 'kfa');

    const clev = typeAll('idclev07').fired;
    check('IDCLEV takes two digits as its argument', clev.length === 1 && clev[0].id === 'warp' && clev[0].arg === '07');
    check('IDCLEV does not fire on one digit', typeAll('idclev7').fired.length === 0);
    check('IDCLEV does not take a letter', typeAll('idclevx7').fired.length === 0);

    const menu = typeAll('idbehold').fired;
    check('bare IDBEHOLD fires the power-up prompt', menu.length === 1 && menu[0].id === 'behold-menu');
    const letters = Object.keys(BEHOLD_POWERS).every(letter => {
        const { fired } = typeAll(`idbehold${letter}`);
        return fired.length === 2 && fired[1].id === 'behold' && fired[1].arg === letter;
    });
    check('IDBEHOLD then V, S, I, R, A or L toggles that power', letters);
    check('IDBEHOLD then any other letter only shows the prompt', typeAll('idbeholdx').fired.length === 1);
    check('the IDBEHOLD letters name every power-up there is',
        Object.values(BEHOLD_POWERS).sort().join() === [...POWER_NAMES].sort().join());

    check('a wrong letter resets the sequence', typeAll('idkxfa').fired.length === 0);
    check('and the code works when typed again', typeAll('iddqxiddqd').fired.length === 1);
    check('a fumbled start still counts ("iidkfa")', typeAll('iidkfa').fired.length === 1);
    check('typing a code twice fires it twice', typeAll('iddqdiddqd').fired.length === 2);
    check('codes run back to back ("iddtiddt")', typeAll('iddtiddt').fired.length === 2);

    const m = new CheatMatcher();
    for (const key of ['i', 'Shift', 'D', 'ArrowLeft', 'D', 'Shift', 'Q', 'd']) m.feed(key);
    check('Shift, arrows and other named keys are ignored rather than resetting', m.buffer === '');
    const m2 = new CheatMatcher();
    let god = null;
    for (const key of ['i', 'Shift', 'D', 'ArrowLeft', 'D', 'Q', 'D']) god = m2.feed(key).cheat || god;
    check('so a code typed in capitals with Shift held fires', god?.id === 'god');
}

console.log('\n[typed into the phone\'s code box]');
{
    const god = cheatsInText('iddqd');
    check('a code typed in the box fires its cheat', god.length === 1 && god[0].id === 'god');
    check('in capitals too, as a phone keyboard may give it', cheatsInText('IDKFA')[0]?.id === 'kfa');
    check('spaces autocorrect slipped in are ignored', cheatsInText('id kfa')[0]?.id === 'kfa');
    const warp = cheatsInText('idclev12');
    check('IDCLEV keeps its digits', warp.length === 1 && warp[0].arg === '12');
    const behold = cheatsInText('idbeholdv');
    check('IDBEHOLDV gives the prompt and then the power, as typed play does',
        behold.map(c => c.id).join() === 'behold-menu,behold' && behold[1].arg === 'v');
    check('anything else fires nothing', cheatsInText('hello').length === 0 && cheatsInText('').length === 0);
    check('nor does a code cut short', cheatsInText('iddq').length === 0);
    check('each entry starts afresh', cheatsInText('id').length === 0 && cheatsInText('dqd').length === 0);
}

console.log('\n[claiming keys from play]');
{
    const { claimed } = typeAll('iddqd');
    check('"i" and "d" are never claimed: a stray "id" still moves', !claimed[0] && !claimed[1]);
    check('keys past "id" that continue a code are claimed', claimed.slice(2).every(Boolean));

    const clev = typeAll('idclev05').claimed;
    check('IDCLEV digits are claimed (no weapon switch)', clev[6] && clev[7]);

    const mypos = typeAll('idmypos').claimed;
    check('the "m" of IDMYPOS is claimed (no minimap toggle)', mypos[2]);

    const off = typeAll('id3').claimed;
    check('a digit that does not continue a code is not claimed', off[2] === false);

    const after = typeAll('iddqd3').claimed;
    check('nor is a key after a finished code', after[5] === false);
}

// =============================================================================
// 2. EFFECTS
// =============================================================================

console.log = noop;
const controller = new GameController();
globalThis.gameController = controller;
const gs = controller.gameState;
gs.selectedDifficulty = 'medium';
gs.startGame();
console.log = origLog;

/** A bare arena, the player in it, nothing else; returns the player. */
function arena(tileX = 20, tileY = 20) {
    gs.gameMap = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_EMPTY));
    gs.decor = null;
    gs.decorLights = [];
    gs.windows = [];
    gs.enemies = [];
    gs.barrels = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.temporaryVisualEffects = [];
    gs.healthPacks = [];
    gs.ammoPacks = [];
    gs.weaponPacks = [];
    gs.powerups = [];
    gs.currentBoss = null;
    gs.mapCheat = 0;
    gs.hudMessage = null;
    gs.gameRunning = true;
    registerSectors(null);
    resetLighting();
    gs.player = new Player(centre(tileX), centre(tileY));
    gs.player.angle = 0;
    return gs.player;
}

/** Types a code at the game, as the matcher would hand it over. */
function cheat(text) {
    let message;
    for (const cheatHit of typeAll(text).fired) message = applyCheat(cheatHit, gs);
    return message;
}

console.log('\n[god mode and no clipping]');
{
    const p = arena();
    p.health = 37;
    check('IDDQD replies in Doom\'s words', cheat('iddqd') === CHEAT_MESSAGES.GOD_ON);
    check('and puts the reply on the message line', gs.hudMessage?.text === CHEAT_MESSAGES.GOD_ON);
    check('god mode sets health to 100', p.health === 100);
    p.takeDamage(50);
    check('god mode: a hit does nothing', p.health === 100);

    gs.gameMap[centre(20) / TILE_SIZE | 0][20] = TILE_LAVA;
    for (let i = 0; i < 120; i++) p.applyTerrainEffects();
    check('god mode: lava does nothing', p.health === 100);
    check('god mode is not no-clipping', p.canPhase === false);

    check('IDDQD again turns it off', cheat('IDDQD') === CHEAT_MESSAGES.GOD_OFF && !p.godMode);
    for (let i = 0; i < 120; i++) p.applyTerrainEffects();
    check('and the lava burns again', p.health < 100);

    p.health = 100;
    check('IDCLIP turns no-clipping on', cheat('idclip') === CHEAT_MESSAGES.NOCLIP_ON && p.canPhase);
    check('no-clipping walks through a wall', (gs.gameMap[5][5] = TILE_WALL, p.isTileBlocking(5, 5) === false));
    p.takeDamage(10);
    check('no-clipping is not god mode: a hit still hurts', p.health === 90 && !p.godMode);
    check('IDSPISPOPD toggles the same switch', cheat('idspispopd') === CHEAT_MESSAGES.NOCLIP_OFF && !p.canPhase);
    check('and walls block again', p.isTileBlocking(5, 5) === true);
}

console.log('\n[arsenal]');
{
    const p = arena();
    check('IDFA replies', cheat('idfa') === CHEAT_MESSAGES.FA);
    check('IDFA: every weapon owned', p.weapons.every(w => w.owned));
    check('IDFA: every ammo pool full', p.weapons.every(w => w.ammo === Infinity || w.ammo === w.maxAmmo));
    check('IDFA: no keys', !p.keysCollected.red && !p.keysCollected.yellow && !p.keysCollected.blue);

    const q = arena();
    check('IDKFA replies', cheat('idkfa') === CHEAT_MESSAGES.KFA);
    check('IDKFA: every weapon and full ammo', q.weapons.every(w => w.owned && (w.ammo === Infinity || w.ammo === w.maxAmmo)));
    check('IDKFA: every key', q.keysCollected.red && q.keysCollected.yellow && q.keysCollected.blue);

    q.currentWeaponIndex = q.weapons.findIndex(w => w.name === 'Shotgun');
    check('IDCHOPPERS replies', cheat('idchoppers') === CHEAT_MESSAGES.CHOPPERS);
    check('IDCHOPPERS puts the knife in hand', q.getCurrentWeapon().name === 'Knife');
}

console.log('\n[power-ups]');
{
    const p = arena();
    check('bare IDBEHOLD lists the powers', cheat('idbehold') === CHEAT_MESSAGES.BEHOLD);

    // Invulnerability
    check('IDBEHOLDV replies "Power-up Toggled"', cheat('idbeholdv') === CHEAT_MESSAGES.BEHOLD_TOGGLED);
    check('invulnerability is on', p.hasPower('invulnerability') && p.isInvulnerable());
    p.takeDamage(40);
    check('invulnerability: a hit does nothing', p.health === 100);
    check('god mode was not switched on by it', p.godMode === false);
    const frames = ticsToFrames(POWER_DURATION_TICS.invulnerability);
    let blinked = false;
    for (let i = 0; i < frames; i++) {
        p.tickPowers();
        if (p.hasPower('invulnerability') && !p.isPowerShowing('invulnerability')) blinked = true;
    }
    check('it runs out after Doom\'s thirty seconds', !p.hasPower('invulnerability'));
    check('and its palette blinks before it does', blinked);
    cheat('idbeholdv');
    cheat('idbeholdv');
    check('IDBEHOLDV again turns it straight off', !p.hasPower('invulnerability'));

    // Berserk
    const baron = new Enemy(centre(21), centre(20), 'baron');
    gs.enemies = [baron];
    const knife = p.weapons.find(w => w.name === 'Knife');
    const swing = () => {
        baron.health = baron.maxHealth;
        baron.isDead = false;
        p.performMeleeAttack(knife);
        return baron.maxHealth - baron.health;
    };
    // A punch is 2-20; berserk makes it 20-200, so the weakest berserk swing
    // is at least the strongest plain one, and they average ten times as much.
    const plain = Array.from({ length: 60 }, swing);
    p.health = 30;
    cheat('idbeholds');
    check('berserk heals to 100', p.health === 100);
    const strong = Array.from({ length: 60 }, swing);
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    check('berserk: every swing hits as hard as the hardest plain one',
        Math.max(...plain) <= 20 && Math.min(...strong) >= 20,
        `plain max ${Math.max(...plain)}, berserk min ${Math.min(...strong)}`);
    check('berserk: ten times the damage', Math.abs(sum(strong) / sum(plain) - 10) < 3,
        `${(sum(strong) / sum(plain)).toFixed(2)}x`);
    for (let i = 0; i < frames * 3; i++) p.tickPowers();
    check('berserk lasts until the level ends, not on a timer', p.hasPower('strength'));
    gs.enemies = [];

    // Partial invisibility
    const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
    check('no wobble at a target in plain sight', shadowAimOffset(p, seq([1, 0])) === 0);
    cheat('idbeholdi');
    const wobble = shadowAimOffset(p, seq([1, 0])) * 180 / Math.PI;
    check('invisibility: aim wanders up to 45 degrees', Math.abs(wobble - 45) < 1e-9, `${wobble}`);
    const imp = new Enemy(centre(30), centre(20), 'imp');
    imp.target = p;
    let widest = 0;
    for (let i = 0; i < 400; i++) widest = Math.max(widest, Math.abs(imp.aimAtTarget() - Math.PI));
    check('a monster\'s shot at an invisible player goes wide', widest > 15 * Math.PI / 180);
    cheat('idbeholdi');
    check('and is dead straight once it is off', imp.aimAtTarget() === Math.atan2(p.y - imp.y, p.x - imp.x));

    // Radiation suit
    p.health = 100;
    gs.gameMap[20][20] = TILE_LAVA;
    cheat('idbeholdr');
    for (let i = 0; i < 120; i++) p.applyTerrainEffects();
    check('radiation suit: lava does nothing', p.health === 100);
    p.takeDamage(10);
    check('but it is no armour against a hit', p.health === 90);
    cheat('idbeholdr');
    gs.gameMap[20][20] = TILE_EMPTY;

    // Computer map, toggled
    cheat('idbeholda');
    check('IDBEHOLDA turns the computer map on', p.hasPower('allmap'));
    cheat('idbeholda');
    check('and, unlike vanilla, off again', !p.hasPower('allmap'));
}

console.log('\n[light amplification]');
{
    const p = arena(20, 20);
    // A wall down column 25: the player can see the room it bounds, not past it
    for (let r = 0; r < MAP_ROWS; r++) gs.gameMap[r][25] = TILE_WALL;
    p.angle = 0;   // The torch points east; tile 14 is well behind the player

    updateLighting(gs);
    const dark = getLightMap()[20][14];
    cheat('idbeholdl');
    updateLighting(gs);
    const lit = getLightMap()[20][14];
    const beyond = getLightMap()[20][28];

    check('IDBEHOLDL switches the lighting to full bright', isFullBright());
    check('a tile behind the player, dark before, is fully lit', dark < 0.2 && lit === 1, `before ${dark}, after ${lit}`);
    check('but nothing past a wall is', beyond === 0, `${beyond}`);
    cheat('idbeholdl');
    updateLighting(gs);
    check('and it goes dark again when switched off', !isFullBright() && getLightMap()[20][14] < 0.2);
}

console.log('\n[level change, map and position]');
{
    const p = arena();
    cheat('iddqd');
    cheat('idbeholdv');
    gs.levelStats = gs.freshLevelStats();
    console.log = noop;
    const reply = cheat('idclev07');
    console.log = origLog;
    check('IDCLEV07 replies', reply === CHEAT_MESSAGES.CLEV);
    check('and warps to level 7', gs.currentLevel === 7 && !!gs.gameMap && gs.player === p);
    check('power-ups end with the level', POWER_NAMES.every(n => !p.hasPower(n)));
    check('god mode carries on', p.godMode === true);
    check('the reply survives the change of level', gs.hudMessage?.text === CHEAT_MESSAGES.CLEV);
    check('IDCLEV00 is refused', cheat('idclev00') === null && gs.currentLevel === 7);

    gs.showMinimap = false;
    gs.mapCheat = 0;
    check('IDDT gives no reply, as in Doom', cheat('iddt') === null);
    check('IDDT: the whole map, and the minimap brought up', gs.mapCheat === 1 && gs.showMinimap);
    cheat('iddt');
    check('IDDT again: the map and every thing on it', gs.mapCheat === 2);
    cheat('iddt');
    check('IDDT a third time: off', gs.mapCheat === 0);

    p.x = 412; p.y = 318; p.angle = -Math.PI / 2;   // Facing up the screen: Doom's north
    const pos = cheat('idmypos');
    check('IDMYPOS prints Doom\'s angle and the position', pos === 'ang=90;x,y=(412,318)', pos);
    check('and turns on the live readout', gs.showCoordinates === true);

    p.health = 0;
    const godBefore = p.godMode;
    check('a dead marine cannot cheat', cheat('iddqd') === null && p.godMode === godBefore && p.health === 0);
    p.health = 100;
}

// =============================================================================
// 3. THE KEYBOARD AND THE SCREEN
// =============================================================================

console.log('\n[keyboard wiring]');
{
    const p = arena();
    const input = controller.inputHandler;
    input.cheats.reset();
    const press = (key, extra = {}) => {
        input.handleKeyDown({ key, repeat: false, preventDefault: noop, ...extra });
        input.handleKeyUp({ key });
    };

    p.collectAllGuns();
    p.currentWeaponIndex = p.weapons.findIndex(w => w.name === 'Pistol');
    console.log = noop;
    for (const ch of 'idclev03') press(ch);
    console.log = origLog;
    check('IDCLEV typed at the keyboard warps', gs.currentLevel === 3);
    check('and its "3" did not switch to the shotgun', gs.player.getCurrentWeapon().name === 'Pistol');
    press('3');
    check('while a plain "3" still does', gs.player.getCurrentWeapon().name === 'Shotgun');

    gs.showMinimap = true;
    for (const ch of 'IDMYPOS') press(ch);
    check('the "M" of IDMYPOS left the minimap alone', gs.showMinimap === true);
    console.log = noop;
    press('m');
    console.log = origLog;
    check('while a plain "m" still toggles it', gs.showMinimap === false);

    input.handleKeyDown({ key: 'i', repeat: false, preventDefault: noop });
    input.handleKeyDown({ key: 'd', repeat: false, preventDefault: noop });
    check('"i" then "d" still moves right', keys.d === true);
    input.handleKeyDown({ key: 'd', repeat: true, preventDefault: noop });
    input.handleKeyDown({ key: 'd', repeat: true, preventDefault: noop });
    check('held-key repeats are not typing', input.cheats.buffer === 'id');
    input.handleKeyUp({ key: 'd' });
    input.handleKeyUp({ key: 'i' });
    input.cheats.reset();
}

console.log('\n[on screen]');
{
    const renderFrame = () => {
        drawLog.length = 0;
        console.log = noop;
        controller.renderGame();
        console.log = origLog;
    };

    gs.mapCheat = 0;
    gs.showMinimap = true;
    renderFrame();
    const unseenBefore = [...controller.minimapStamped].filter(v => v === 255).length;

    gs.player.givePower('allmap');
    renderFrame();
    const grey = [...controller.minimapStamped].filter(v => v >= 128 && v < 255).length;
    check('the computer map stamps unseen tiles grey', grey > 0 && unseenBefore > 0, `${grey} grey`);

    gs.mapCheat = 1;
    renderFrame();
    const unstamped = [...controller.minimapStamped].filter(v => v === 255).length;
    const greyLeft = [...controller.minimapStamped].filter(v => v >= 128 && v < 255).length;
    check('IDDT puts the whole level on the minimap, in colour', unstamped === 0 && greyLeft === 0,
        `${unstamped} unstamped, ${greyLeft} grey`);

    gs.mapCheat = 0;
    gs.player.clearPowers();
    renderFrame();
    const forgotten = [...controller.minimapStamped].filter(v => v === 255).length;
    check('and switching both off takes the unseen tiles away again', forgotten > 0);

    gs.mapCheat = 2;
    gs.showMinimap = true;
    gs.enemies = [new Enemy(centre(5), centre(5), 'imp')];
    renderFrame();
    check('IDDT twice draws the things', drawLog.some(o => o.tag === 'gameCanvas' && o.op === 'fillStyle' && o.args[0] === MINIMAP.THING_MONSTER));
    gs.mapCheat = 0;
    gs.enemies = [];

    gs.postMessage(CHEAT_MESSAGES.KFA);
    renderFrame();
    check('the message line draws the reply', drawLog.some(o => o.tag === 'gameCanvas' && o.op === 'fillText' && o.args[0] === CHEAT_MESSAGES.KFA));
    gs.hudMessage.postedAt -= 5000;
    renderFrame();
    check('and lets it go after four seconds', gs.hudMessage === null &&
        !drawLog.some(o => o.op === 'fillText' && o.args[0] === CHEAT_MESSAGES.KFA));

    const sightLaidOn = () => drawLog.some(o => o.op === 'drawImage' && o.args[0] === controller.sightMaskCanvas &&
                                                o.args.length === 3);
    renderFrame();
    check('without the visor the sight mask is not laid on the light mask whole', !sightLaidOn());
    gs.player.givePower('infrared');
    renderFrame();
    check('with it, everything in sight is lit on screen too', sightLaidOn());
    gs.player.clearPowers();

    gs.player.givePower('invulnerability');
    renderFrame();
    check('invulnerability inverts the view', drawLog.some(o => o.tag === 'gameCanvas' && o.op === 'gco' && o.args[0] === 'difference'));
    gs.player.clearPowers();
    renderFrame();
    check('and only while it is on', !drawLog.some(o => o.op === 'gco' && o.args[0] === 'difference'));
}

console.log('');
if (failures === 0) {
    console.log('All cheat checks passed.');
    process.exit(0);
} else {
    console.error(`${failures} cheat check(s) FAILED.`);
    process.exit(1);
}
