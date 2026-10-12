// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Doom monster checks. Run with: npm test
 *
 * Two halves:
 *
 *   1. The roster and the formulas in js/monsters.js, in isolation: every
 *      monster names artwork that exists, the spawn tables only hand out
 *      monsters that exist, and P_CheckMissileRange / P_NewChaseDir behave the
 *      way the p_enemy.c originals do at their edge cases.
 *
 *   2. The behaviour those produce on a live Enemy in a real GameState: waking
 *      by sight and by sound, eight-direction chasing, hitscan and melee
 *      landing on the player, projectiles starting fights between monsters,
 *      pain interrupting attacks, the Pain Elemental's and Arch-vile's party
 *      tricks, and the player's run key.
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

/** Runs fn with Math.random pinned to a value, then restores it. */
function withRandom(value, fn) {
    const real = Math.random;
    Math.random = () => value;
    try { return fn(); } finally { Math.random = real; }
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
const { Enemy, Player, Boss, MiniBoss } = await import('../js/entities.js');
const monsters = await import('../js/monsters.js');
const { MONSTER_VOICES } = await import('../js/audio-system.js');
const sprites = await import('../js/enemy-sprites.js');
const { keys, mouse, resetInputState } = await import('../js/input-handler.js');
const { TILE_SIZE, MAP_COLS, MAP_ROWS, PLAYER_WALK_SPEED, PLAYER_RUN_SPEED, getDifficultyMultipliers } = await import('../js/constants.js');

await sprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');

console.log = origLog;
console.warn = origWarn;

globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const {
    MONSTERS, MONSTER_TYPES, SPAWN_TABLE, DIR, DIR_VECTORS,
    pickMonsterType, bossTypeForTier, checkMissileRange, newChaseDir, hitscanSpread,
    chaseSpeedPx, unitsToPx, ticsToFrames, LOOK_INTERVAL_TICS, LOST_SOUL_LIMIT,
} = monsters;

console.log('\n=== monsters ===\n');

// =============================================================================
// 1. THE ROSTER
// =============================================================================

console.log('[roster]');
{
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'sprites/enemies/manifest.json'), 'utf8'));
    const bad = [];
    for (const type of MONSTER_TYPES) {
        const def = MONSTERS[type];
        if (!manifest.characters[def.sprite]) bad.push(`${type}: no sprite "${def.sprite}"`);
        if (!(def.hp > 0 && def.speed > 0 && def.chaseTics > 0 && def.radius > 0)) bad.push(`${type}: stats`);
        if (!(def.painChance >= 0 && def.painChance <= 256 && def.painTics > 0)) bad.push(`${type}: pain`);
        if (!def.melee && !def.missile) bad.push(`${type}: no attack`);
        if (!MONSTER_VOICES[def.sounds]) bad.push(`${type}: voice "${def.sounds}" is not in audio-system.js`);
    }
    check('every monster is complete and names real artwork', bad.length === 0, bad.join('; '));

    const doom1 = MONSTER_TYPES.filter(t => MONSTERS[t].doom === 1).length;
    const doom2 = MONSTER_TYPES.filter(t => MONSTERS[t].doom === 2).length;
    check('the roster covers Doom and Doom II', doom1 === 10 && doom2 === 8, `${doom1} + ${doom2}`);

    const looks = new Map();
    for (const type of MONSTER_TYPES) {
        const slug = MONSTERS[type].sprite;
        looks.set(slug, (looks.get(slug) || 0) + 1);
    }
    const shared = [...looks.entries()].filter(([, n]) => n > 1).map(([s]) => s);
    check('only the Demon and Spectre share a look', shared.length === 1 && shared[0] === MONSTERS.demon.sprite,
        shared.join(', '));

    check('the Spectre is drawn faint and the Demon is not',
        MONSTERS.spectre.alpha < 1 && (MONSTERS.demon.alpha === undefined || MONSTERS.demon.alpha === 1));
}

console.log('[spawn tables]');
{
    const unknown = [];
    for (const row of SPAWN_TABLE) {
        for (const type of Object.keys(row.weights)) {
            if (!MONSTERS[type]) unknown.push(type);
        }
    }
    check('spawn tables only name real monsters', unknown.length === 0, unknown.join(', '));

    const early = new Set();
    for (let i = 0; i < 300; i++) early.add(pickMonsterType(1));
    check('level 1 is zombies and imps', [...early].every(t => ['zombieman', 'shotgun_guy', 'imp'].includes(t)),
        [...early].join(', '));

    const late = new Set();
    for (let i = 0; i < 1500; i++) late.add(pickMonsterType(14));
    check('late levels field the Doom II bestiary',
        ['chaingunner', 'revenant', 'mancubus', 'arachnotron', 'archvile'].every(t => late.has(t)),
        [...late].join(', '));
    check('bosses never spawn as regular monsters',
        ![...late].some(t => MONSTERS[t].boss));

    check('boss levels alternate Cyberdemon and Spider',
        bossTypeForTier(1) === 'cyberdemon' && bossTypeForTier(2) === 'spider_mastermind' &&
        bossTypeForTier(3) === 'cyberdemon');
}

console.log('[speeds]');
{
    const zombie = chaseSpeedPx(MONSTERS.zombieman.speed, MONSTERS.zombieman.chaseTics);
    const demon = chaseSpeedPx(MONSTERS.demon.speed, MONSTERS.demon.chaseTics);
    const vile = chaseSpeedPx(MONSTERS.archvile.speed, MONSTERS.archvile.chaseTics);
    check('a Demon is two and a half times a Zombieman', Math.abs(demon / zombie - 2.5) < 0.01,
        `${(demon / zombie).toFixed(2)}`);
    check('the Arch-vile is the fastest walker',
        MONSTER_TYPES.every(t => chaseSpeedPx(MONSTERS[t].speed, MONSTERS[t].chaseTics) <= vile + 1e-9));
    check('a walking marine outpaces a Demon', PLAYER_WALK_SPEED > demon);
    check('a running marine outpaces the Arch-vile', PLAYER_RUN_SPEED > vile);

    // The marine's own numbers, from P_MovePlayer: he accelerates by
    // forwardmove*2048 a tic against 0.90625 friction, settling at 8 1/3 map
    // units a tic walking and exactly twice that running.
    const unitsPerTic = (px) => px * (60 / 35) / (TILE_SIZE / 64);
    check("the marine walks at Doom's 8 1/3 units a tic",
        Math.abs(unitsPerTic(PLAYER_WALK_SPEED) - 25 / 3) < 0.001,
        unitsPerTic(PLAYER_WALK_SPEED).toFixed(3));
    check('...and runs at exactly twice that',
        Math.abs(PLAYER_RUN_SPEED / PLAYER_WALK_SPEED - 2) < 1e-9,
        (PLAYER_RUN_SPEED / PLAYER_WALK_SPEED).toFixed(3));
    // Which is what makes the Arch-vile frightening: he is 90% of a walk, so
    // walking away from one does not work.
    check('an Arch-vile nearly keeps pace with a walking marine',
        vile > PLAYER_WALK_SPEED * 0.85 && vile < PLAYER_WALK_SPEED,
        `${(vile / PLAYER_WALK_SPEED * 100).toFixed(0)}% of a walk`);

    // Every monster's speed is info.c's, moved once per see-state frame.
    const DOOM = {
        zombieman: [8, 4], shotgun_guy: [8, 3], imp: [8, 3], demon: [10, 2], spectre: [10, 2],
        lost_soul: [8, 6], cacodemon: [8, 3], baron: [8, 3], cyberdemon: [16, 3],
        spider_mastermind: [12, 3], chaingunner: [8, 3], hell_knight: [8, 3], revenant: [10, 2],
        mancubus: [8, 4], arachnotron: [12, 3], pain_elemental: [8, 3], archvile: [15, 2], ss: [8, 3],
    };
    const wrong = Object.entries(DOOM).filter(([type, [speed, tics]]) =>
        !MONSTERS[type] || MONSTERS[type].speed !== speed || MONSTERS[type].chaseTics !== tics);
    check('every monster moves at its own Doom speed', wrong.length === 0,
        wrong.map(([t]) => t).join(', '));
    check('...and the roster holds no others', MONSTER_TYPES.length === Object.keys(DOOM).length);
}

// =============================================================================
// 2. THE FORMULAS
// =============================================================================

console.log('[P_CheckMissileRange]');
{
    const imp = MONSTERS.imp;
    check('point blank, a monster always fires', checkMissileRange(imp, 0, { random: () => 0.999 }));
    // At range the distance clamps to 200: a 56-in-256 chance.
    check('at range the chance is 56 in 256',
        checkMissileRange(imp, 2000, { random: () => 0.21 }) && !checkMissileRange(imp, 2000, { random: () => 0.23 }));
    check('reaction time holds fire', !checkMissileRange(imp, 0, { reactionTime: 3, random: () => 0 }));
    check('a monster that was just hit fires back', checkMissileRange(imp, 5000, { justHit: true, random: () => 0.999 }));

    const zombie = MONSTERS.zombieman;
    // No melee: 128 units are knocked off, so a zombie at 190 units is "point blank".
    check('monsters without melee fire more readily',
        checkMissileRange(zombie, 190, { random: () => 0.999 }) && !checkMissileRange(imp, 190, { random: () => 0.999 }));

    // The 14-tile limit is applied after the 64 every monster subtracts and
    // the 128 a monster with no melee attack subtracts.
    const vileLimit = 14 * 64 + 64 + 128;
    check('the Arch-vile will not attack beyond 14 tiles',
        !checkMissileRange(MONSTERS.archvile, vileLimit + 1, { random: () => 0 }) &&
        checkMissileRange(MONSTERS.archvile, vileLimit - 1, { random: () => 0 }));
    check('the Revenant punches rather than fires up close',
        !checkMissileRange(MONSTERS.revenant, 64 + 195, { random: () => 0 }) &&
        checkMissileRange(MONSTERS.revenant, 64 + 197, { random: () => 0 }));
    check('the Cyberdemon caps its distance at 160',
        checkMissileRange(MONSTERS.cyberdemon, 10000, { random: () => 0.37 }) &&
        !checkMissileRange(MONSTERS.cyberdemon, 10000, { random: () => 0.38 }));
    check('difficulty scales the chance',
        !checkMissileRange(imp, 2000, { random: () => 0.21, chanceScale: 0.5 }) &&
        checkMissileRange(imp, 2000, { random: () => 0.4, chanceScale: 2 }));
}

console.log('[P_NewChaseDir]');
{
    const open = () => true;
    check('open ground: straight down the diagonal',
        newChaseDir({ dx: 100, dy: -100, oldDir: DIR.NONE, tryWalk: open, random: () => 0 }) === DIR.NORTHEAST);
    check('the diagonal follows the target quadrant',
        newChaseDir({ dx: -100, dy: 100, oldDir: DIR.NONE, tryWalk: open, random: () => 0 }) === DIR.SOUTHWEST);

    const noDiagonals = (dir) => dir % 2 === 0;
    check('diagonal blocked: the longer axis', newChaseDir({ dx: 30, dy: -100, oldDir: DIR.NONE, tryWalk: noDiagonals, random: () => 0 }) === DIR.NORTH);
    // With x the longer axis, one roll in five tries y first anyway: the wobble.
    check('...unless the roll says otherwise',
        newChaseDir({ dx: 100, dy: -30, oldDir: DIR.NONE, tryWalk: noDiagonals, random: () => 0 }) === DIR.EAST &&
        newChaseDir({ dx: 100, dy: -30, oldDir: DIR.NONE, tryWalk: noDiagonals, random: () => 0.99 }) === DIR.NORTH);

    const onlyWest = (dir) => dir === DIR.WEST;
    check('turning round is the last resort',
        newChaseDir({ dx: 100, dy: 0, oldDir: DIR.EAST, tryWalk: onlyWest, random: () => 0 }) === DIR.WEST);
    const onlyNorthOrWest = (dir) => dir === DIR.WEST || dir === DIR.NORTH;
    check('...and never chosen while anything else is open',
        newChaseDir({ dx: 100, dy: 0, oldDir: DIR.EAST, tryWalk: onlyNorthOrWest, random: () => 0 }) === DIR.NORTH);
    check('stuck fast: no direction',
        newChaseDir({ dx: 100, dy: 0, oldDir: DIR.EAST, tryWalk: () => false, random: () => 0 }) === DIR.NONE);

    const tried = [];
    newChaseDir({ dx: 5, dy: 0, oldDir: DIR.NONE, tryWalk: (d) => { tried.push(d); return false; }, random: () => 0.7 });
    check('a target underfoot means no axis is preferred',
        !tried.includes(DIR.EAST) || tried.indexOf(DIR.EAST) > 0 || tried.length === 8,
        tried.join(','));
}

console.log('[hitscan spread]');
{
    let worst = 0;
    for (let i = 0; i < 2000; i++) worst = Math.max(worst, Math.abs(hitscanSpread()));
    const limit = 22.5 * Math.PI / 180;
    check('bullets scatter within 22.5 degrees', worst <= limit + 1e-9 && worst > limit * 0.5, worst.toFixed(3));
}

// =============================================================================
// 3. LIVE BEHAVIOUR
// =============================================================================

/** An empty hall with a solid border. */
function openMap() {
    const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
    for (let r = 2; r < MAP_ROWS - 2; r++) for (let c = 2; c < MAP_COLS - 2; c++) map[r][c] = 0;
    return map;
}

const gs = new GameState();
gs.selectedDifficulty = 'medium';
gs.currentLevel = 1;

const T = TILE_SIZE;
const centre = (tile) => tile * T + T / 2;

/** Resets the world: fresh map, player at a tile, no monsters. */
function world(playerTileX = 20, playerTileY = 20) {
    gs.gameMap = openMap();
    gs.enemies = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.temporaryVisualEffects = [];
    gs.healthPacks = [];
    gs.ammoPacks = [];
    gs.currentBoss = null;
    gs.noiseTiles = null;
    gs.noiseFrame = -1;
    gs.corpsesPersist = false;
    gs.player = new Player(centre(playerTileX), centre(playerTileY));
    gs.player.health = 100000;
    gs.player.maxHealth = 100000;
    resetInputState();
    return gs.player;
}

/** Places a monster, awake or not, facing an angle. */
function place(type, tileX, tileY, { angle = 0, ambush = false, target = null } = {}) {
    const e = new Enemy(centre(tileX), centre(tileY), type);
    e.ambush = ambush;
    e.face(angle);
    if (target) e.acquireTarget(target, false);
    gs.enemies.push(e);
    return e;
}

/**
 * Runs the whole game loop for n frames. An optional probe is called after
 * every frame and the frames report whether it ever returned true, for things
 * that only exist for a few frames.
 */
function frames(n, probe = null) {
    let seen = false;
    for (let i = 0; i < n; i++) {
        gs.frameCount++;
        gs.update();
        gs.player.health = gs.player.maxHealth = Math.max(gs.player.health, 1000);
        if (probe && probe()) seen = true;
    }
    return seen;
}

const LOOK = ticsToFrames(LOOK_INTERVAL_TICS);

console.log('[A_Look: waking]');
{
    const player = world();
    // Five tiles east, looking east: the player is behind it.
    const zombie = place('zombieman', 25, 20, { angle: 0 });
    frames(LOOK * 4);
    check('a monster does not see what is behind it', zombie.target === null && zombie.state === 'idle');

    zombie.face(Math.PI);
    frames(LOOK + 1);
    check('a monster sees the player in front of it', zombie.target === player && zombie.state === 'chase');
}
{
    const player = world();
    const behind = place('imp', 25, 20, { angle: 0 });
    const deaf = place('imp', 20, 25, { angle: Math.PI / 2, ambush: true });   // facing away
    // A deaf one behind a wall, and a hearing one behind the same wall.
    for (let r = 2; r < MAP_ROWS - 2; r++) gs.gameMap[r][30] = 1;
    gs.gameMap[28][30] = 0;   // a gap, so sound can get round
    const walled = place('imp', 35, 20, { angle: 0 });
    const walledDeaf = place('imp', 35, 22, { angle: 0, ambush: true });
    const sealed = place('imp', 45, 20, { angle: Math.PI });
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        gs.gameMap[20 + dy][45 + dx] = 1;
    }

    frames(LOOK * 2);
    check('quiet: nothing wakes', [behind, deaf, walled, walledDeaf, sealed].every(e => e.target === null));

    gs.noiseAlert(player.x, player.y);
    frames(LOOK + 1);
    check('a shot wakes a monster facing away', behind.target === player);
    check('a shot wakes a deaf monster only if it can see', deaf.target === player && walledDeaf.target === null);
    check('sound goes round walls', walled.target === player);
    check('sound does not go through them', sealed.target === null);
}

console.log('[A_Chase: hunting]');
{
    const player = world();
    const imp = place('imp', 32, 20, { target: player });
    const before = imp.distanceTo(player);
    const steps = [];
    let last = { x: imp.x, y: imp.y };
    for (let i = 0; i < 90; i++) {
        frames(1);
        steps.push([imp.x - last.x, imp.y - last.y]);
        last = { x: imp.x, y: imp.y };
    }
    check('a chasing monster closes on its target', imp.distanceTo(player) < before - 40,
        `${before.toFixed(0)} -> ${imp.distanceTo(player).toFixed(0)}`);

    const legal = steps.every(([dx, dy]) => {
        if (dx === 0 && dy === 0) return true;
        return DIR_VECTORS.some(([vx, vy]) =>
            Math.abs(dx - vx * imp.speed) < 1e-6 && Math.abs(dy - vy * imp.speed) < 1e-6);
    });
    check('every step is one of eight directions at the monster\'s speed', legal);
    check('a monster never forgets its target', imp.target === player);
}
{
    const player = world();
    const a = place('demon', 26, 20, { target: player });
    const b = place('demon', 26, 21, { target: player });
    frames(200);
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    check('monsters do not walk through each other', gap >= a.radius + b.radius - 1, gap.toFixed(1));
    const toPlayer = Math.min(a.distanceTo(player), b.distanceTo(player));
    check('nor through the player', toPlayer >= a.radius + player.radius - 1, toPlayer.toFixed(1));
}

console.log('[projectile scale]');
{
    // info.c quotes a projectile's radius in map units and the bestiary keeps
    // them that way, so firing one has to convert it like every other length.
    // It is both the ball's collision radius and the size it is drawn.
    const unit = TILE_SIZE / 64;
    check("the bestiary holds Doom's radii",
        MONSTERS.imp.missile.projectile.radius === 6 &&
        MONSTERS.cacodemon.missile.projectile.radius === 6 &&
        MONSTERS.baron.missile.projectile.radius === 6 &&
        MONSTERS.mancubus.missile.projectile.radius === 6 &&
        MONSTERS.revenant.missile.projectile.radius === 11 &&
        MONSTERS.cyberdemon.missile.projectile.radius === 11 &&
        MONSTERS.arachnotron.missile.projectile.radius === 13);

    const player = world();
    const imp = place('imp', 28, 20, { target: player });
    imp.fireProjectile(MONSTERS.imp.missile.projectile);
    const ball = gs.bullets[gs.bullets.length - 1];
    check('a fired fireball carries that radius in pixels',
        Math.abs(ball.radius - 6 * unit) < 1e-9, `${ball.radius} vs ${6 * unit}`);
    check('...which is a third of the Imp it came from, as in Doom',
        ball.radius * 2 < imp.radius && ball.radius * 2 > imp.radius * 0.4,
        `ball ${(ball.radius * 2).toFixed(1)}px across, Imp ${(imp.radius * 2).toFixed(1)}px`);
    check('...and it leaves clear of its own body',
        Math.hypot(ball.x - imp.x, ball.y - imp.y) >= imp.radius + ball.radius);

    gs.bullets.length = 0;
    const spider = place('arachnotron', 30, 24, { target: player });
    spider.fireProjectile(MONSTERS.arachnotron.missile.projectile);
    const plasma = gs.bullets[gs.bullets.length - 1];
    check("an Arachnotron's plasma is the bigger ball", plasma.radius > ball.radius,
        `${plasma.radius.toFixed(2)} vs ${ball.radius.toFixed(2)}`);
}

console.log('[attacks]');
{
    const player = world();
    const demon = place('demon', 21, 20, { target: player });
    const hp = player.health;
    withRandom(0, () => frames(80));
    check('a Demon in reach bites', player.health < hp, `${hp} -> ${player.health}`);
    check('the bite is a Doom roll', (hp - player.health) % (4 * demon.damageScale) < 1e-6);
}
{
    const player = world();
    place('zombieman', 26, 20, { target: player });
    const hp = player.health;
    const traced = withRandom(0, () => frames(120, () => gs.temporaryVisualEffects.some(e => e.type === 'tracer')));
    check('a Zombieman with a line of sight shoots the player', player.health < hp);
    check('the shot leaves a tracer', traced);

    world();
    const p2 = gs.player;
    for (let r = 2; r < MAP_ROWS - 2; r++) gs.gameMap[r][23] = 1;
    place('zombieman', 26, 20, { target: p2 });
    const hp2 = p2.health;
    withRandom(0, () => frames(200));
    check('...and not through a wall', p2.health === hp2);
}
{
    const player = world();
    const imp = place('imp', 26, 20, { target: player });
    const thrown = withRandom(0, () => frames(120, () => gs.bullets.some(b => b.shooter === imp)));
    check('an Imp at range throws a fireball', thrown);
}

console.log('[pain]');
{
    const player = world();
    const imp = place('imp', 26, 20, { target: player });
    imp.startAttack('missile');
    check('the attack is under way', imp.attack !== null && imp.state === 'attack');
    withRandom(0, () => imp.takeDamage(1));
    check('a hit that passes the pain roll cancels the attack',
        imp.attack === null && imp.state === 'pain' && imp.painTimer > 0 && imp.justHit);
    frames(imp.painFrames + 1);
    check('the pain state ends on its own', imp.painTimer === 0 && imp.state !== 'pain');

    const baron = place('baron', 30, 20, { target: player });
    baron.startAttack('missile');
    withRandom(0.99, () => baron.takeDamage(1));
    check('a hit that fails the roll changes nothing', baron.attack !== null && baron.state === 'attack');

    const skull = place('lost_soul', 34, 20, { target: player });
    skull.beginCharge(skull.def.missile);
    withRandom(0, () => skull.takeDamage(1));
    check('a charging Lost Soul cannot be stopped', skull.charge !== null);
}

console.log('[infighting]');
{
    const player = world();
    const imp = place('imp', 20, 24, { angle: 0 });
    const demon = place('demon', 26, 24, { angle: Math.PI });
    imp.acquireTarget(demon, false);
    withRandom(0.5, () => imp.fireProjectile(imp.def.missile.projectile, 0));
    const hp = demon.health;
    for (let i = 0; i < 90 && gs.bullets.length > 0; i++) {
        gs.updateBullets();
        gs.resolveBulletCollisions();
    }
    check('a fireball hurts the monster it hits', demon.health < hp);
    check('...who turns on the shooter', demon.target === imp && demon.threshold > 0);

    withRandom(0.99, () => demon.takeDamage(1, player));
    check('a committed monster ignores the player', demon.target === imp);
    demon.threshold = 0;
    withRandom(0.99, () => demon.takeDamage(1, player));
    check('...until its threshold runs out', demon.target === player);
}
{
    world();
    const shooter = place('imp', 20, 28, { angle: 0 });
    const brother = place('imp', 26, 28, { angle: Math.PI });
    shooter.acquireTarget(brother, false);
    withRandom(0.5, () => shooter.fireProjectile(shooter.def.missile.projectile, 0));
    const hp = brother.health;
    for (let i = 0; i < 90 && gs.bullets.length > 0; i++) {
        gs.updateBullets();
        gs.resolveBulletCollisions();
    }
    check('a fireball bursts harmlessly on the same species', brother.health === hp && gs.bullets.length === 0);
    check('...and the brother is not provoked', brother.target !== shooter);
}
{
    const player = world();
    const vile = place('archvile', 26, 20, { angle: Math.PI });
    const imp = place('imp', 30, 20, { angle: 0 });
    imp.takeDamage(1, vile);
    check('nobody turns on an Arch-vile', imp.target !== vile);
    vile.acquireTarget(player, false);
    vile.threshold = 100;
    vile.takeDamage(1, imp);
    check('the Arch-vile turns on anyone who hurts it', vile.target === imp);
}

console.log('[Pain Elemental and Lost Souls]');
{
    const player = world();
    const pain = place('pain_elemental', 26, 20, { target: player });
    pain.takeDamage(1e9);
    const souls = gs.enemies.filter(e => e.enemyType === 'lost_soul');
    check('a dying Pain Elemental releases three Lost Souls', souls.length === 3, `${souls.length}`);
    check('...already flying', souls.every(s => s.charge !== null && s.target === player));

    for (let i = 0; i < LOST_SOUL_LIMIT; i++) place('lost_soul', 10 + (i % 10), 30 + Math.floor(i / 10));
    const before = gs.enemies.length;
    const another = place('pain_elemental', 40, 20, { target: player });
    another.takeDamage(1e9);
    check('the level holds no more than the Lost Soul limit', gs.enemies.length === before + 1);
}

console.log('[Arch-vile]');
{
    const player = world(40, 20);
    const imp = place('imp', 26, 20, { angle: 0 });
    imp.takeDamage(1e9);
    for (let i = 0; i < 400; i++) imp.update();
    check('a corpse is cleared once its animation is done', imp.isReadyToRemove());

    const vile = place('archvile', 24, 20, { angle: 0, target: player });
    gs.updateEnemies();
    check('...but not while an Arch-vile lives', !imp.isReadyToRemove() && gs.corpsesPersist);

    withRandom(0.99, () => frames(200));
    check('the Arch-vile raises the corpse it walks over',
        !imp.isDead && imp.health === imp.maxHealth && gs.enemies.includes(imp));

    vile.takeDamage(1e9);
    imp.takeDamage(1e9);
    for (let i = 0; i < 400; i++) imp.update();
    gs.updateEnemies();
    check('with the Arch-vile dead the corpses go', !gs.enemies.includes(imp));
}

console.log('[bosses]');
{
    world();
    const cyber = new Boss(centre(30), centre(20), 5);
    const spider = new Boss(centre(30), centre(20), 10);
    check('level 5 is the Cyberdemon and level 10 the Spider',
        cyber.enemyType === 'cyberdemon' && spider.enemyType === 'spider_mastermind');
    check('bosses take splash immunity from their definition', cyber.def.splashImmune && spider.def.splashImmune);
    check('boss hit points are Doom\'s, unscaled', cyber.maxHealth === 4000 && spider.maxHealth === 3000,
        `${cyber.maxHealth} / ${spider.maxHealth}`);
    check('a Cyberdemon walks in with three rockets', cyber.def.missile.shots.length === 3);
    const mini = new MiniBoss(centre(30), centre(20));
    check('the mini-boss is a Baron of Hell', mini.enemyType === 'baron' && mini.isMiniBoss);
    const spectre = new Enemy(centre(30), centre(20), 'spectre');
    check('a Spectre is a faint Demon', spectre.alpha < 1 && spectre.speed === new Enemy(0, 0, 'demon').speed);
}

console.log("[Doom's numbers, at every level and skill]");
{
    // Doom never scaled a monster. An Imp is 60 hit points on level one and on
    // level twelve, on Easy and on Hard; its claw is 3-24 and its speed 8
    // units every 3 tics, whatever the skill.
    const base = new Enemy(0, 0, 'imp');
    const at = (level, difficulty) => {
        gs.currentLevel = level;
        gs.selectedDifficulty = difficulty;
        const e = new Enemy(0, 0, 'imp');
        gs.currentLevel = 1;
        gs.selectedDifficulty = 'medium';
        return e;
    };
    const far = at(12, 'medium');
    const easy = at(1, 'easy');
    const hard = at(9, 'hard');
    check('hit points never change with the level', base.maxHealth === 60 && far.maxHealth === 60,
        `${base.maxHealth} / ${far.maxHealth}`);
    check('...nor with the skill', easy.maxHealth === 60 && hard.maxHealth === 60);
    check('speed never changes with the skill', easy.speed === base.speed && hard.speed === base.speed);
    check('damage dice never change with the skill', easy.damageScale === 1 && hard.damageScale === 1 && base.damageScale === 1);
    check('the chance to fire never changes with the skill', easy.attackChanceScale === 1 && hard.attackChanceScale === 1);
    check('a Baron of Hell mini-boss is a Baron', new MiniBoss(0, 0).maxHealth === 1000);
    check('a monster sees as far as the map', monsters.SIGHT_RANGE >= TILE_SIZE * 80);

    // The skill's own two effects: what the player feels, and how many there are
    const skills = ['easy', 'medium', 'hard'].map(getDifficultyMultipliers);
    check("I'm Too Young To Die halves the damage the player takes",
        skills[0].damageTaken === 0.5 && skills[1].damageTaken === 1 && skills[2].damageTaken === 1);
    check('...and places fewer monsters; Ultra-Violence places more',
        skills[0].monsterCount < skills[1].monsterCount && skills[1].monsterCount < skills[2].monsterCount);
    world();
    gs.selectedDifficulty = 'easy';
    gs.player.health = 100;
    gs.player.takeDamage(40);
    const easyLeft = gs.player.health;
    gs.selectedDifficulty = 'hard';
    gs.player.health = 100;
    gs.player.takeDamage(40);
    const hardLeft = gs.player.health;
    gs.selectedDifficulty = 'medium';
    check('a 40-point hit is 20 on Easy and 40 on Hard', easyLeft === 80 && hardLeft === 60, `${easyLeft} / ${hardLeft}`);
}

console.log('[running]');
{
    const player = world();
    keys.d = true;
    const x0 = player.x;
    player.update();
    const walked = player.x - x0;
    keys.Shift = true;
    const x1 = player.x;
    player.update();
    const ran = player.x - x1;
    resetInputState();
    check('walking moves at the walking speed', Math.abs(walked - PLAYER_WALK_SPEED) < 1e-9, walked.toFixed(2));
    check('holding Shift moves at the running speed', Math.abs(ran - PLAYER_RUN_SPEED) < 1e-9, ran.toFixed(2));
    check('the player knows it is running', player.isRunning === true);
    player.update();
    check('...and when it is not', player.isRunning === false);
}

console.log('[a level of monsters]');
{
    console.log = noop;
    gs.startGame();
    gs.currentLevel = 9;
    gs.nextMiniBossSpawnLevel = 1000;   // a regular level, not the Baron's
    gs.initLevel();
    console.log = origLog;
    const types = new Set(gs.enemies.map(e => e.enemyType));
    check('a generated level is populated from the roster', gs.enemies.length > 0 && [...types].every(t => MONSTERS[t]),
        [...types].join(', '));
    check('every monster spawns standing', gs.enemies.every(e => e.state === 'idle' && e.target === null));
    check('some monsters lie in ambush', gs.enemies.some(e => e.ambush) && gs.enemies.some(e => !e.ambush));
    gs.clearLevelTransition();
}

// ---------------------------------------------------------------- Result

console.log('');
if (failures === 0) {
    console.log('All monster checks passed.');
} else {
    console.log(`${failures} monster check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
