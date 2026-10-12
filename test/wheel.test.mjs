// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Mouse wheel. Run with: npm test
 *
 *   1. Cycling. Wheel down is the next weapon and up the previous, in slot
 *      order, skipping weapons not carried or without a shot's worth of ammo
 *      (the BFG wants forty cells), wrapping round at both ends. The knife
 *      always counts. Checked on the real Player's inventory.
 *   2. Accumulation. One mouse notch is one switch whatever its size; a
 *      trackpad's small deltas need to add up to the threshold; deltaMode
 *      lines are scaled to pixels; a swipe is cooled down, not a dozen
 *      switches; reversing or pausing starts a fresh gesture.
 *   3. The handler. Ctrl+wheel zooms (up in, down out) and calls
 *      preventDefault, in play or not; the plain wheel switches only in
 *      active play; events from inside an overlay are left alone entirely.
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

// ---------------------------------------------------------------- DOM stubs
// Player imports the renderer's helpers, which reach for a document at load.
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
globalThis.window = globalThis;
globalThis.document = {
    getElementById: (id) => makeElement(id), querySelector: (s) => makeElement(s), querySelectorAll: () => [],
    createElement: () => makeElement('created'), addEventListener: noop, removeEventListener: noop, hidden: false,
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.Image = class { constructor() { this.complete = true; this.naturalHeight = 64; } addEventListener() {} };

const origLog = console.log;
const origWarn = console.warn;
console.log = noop;
console.warn = noop;

const { GameState } = await import('../js/game-state.js');
const { Player } = await import('../js/entities.js');
const { InputHandler } = await import('../js/input-handler.js');
const {
    WHEEL, WheelAccumulator, wheelPixels, cycleWeaponIndex, isWheelSelectable, isActivePlay,
} = await import('../js/mouse-wheel.js');
const { TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY } = await import('../js/constants.js');

console.log = origLog;
console.warn = origWarn;

/** A controller that counts zoom calls and clamps the way main.js does. */
const controller = {
    canvas: { width: 1200, height: 800 },
    zoomLevel: 1.4, minZoom: 0.5, maxZoom: 3.0, zoomStep: 0.1,
    zoomIn() { this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep); },
    zoomOut() { this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep); },
};
globalThis.gameController = controller;

const gs = new GameState();
globalThis.gameState = gs;
gs.selectedDifficulty = 'medium';
gs.currentLevel = 1;
gs.gameMap = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILE_EMPTY));

const centre = (tile) => tile * TILE_SIZE + TILE_SIZE / 2;
const NAMES = ['Knife', 'Pistol', 'Shotgun', 'Rifle', 'Rocket Launcher', 'Plasma Gun', 'BFG'];

/** A fresh player, holding the pistol with its starting bullets. */
function freshPlayer() {
    console.log = noop;
    const player = new Player(centre(20), centre(20));
    console.log = origLog;
    gs.player = player;
    return player;
}

const at = (player, name) => player.weapons.findIndex(w => w.name === name);
const nameOf = (player, index) => player.weapons[index]?.name;

console.log('\n=== mouse wheel ===\n');

// =============================================================================
// CYCLING
// =============================================================================

console.log('[Cycling]');
{
    const p = freshPlayer();
    check('the inventory is the seven weapons in slot order',
        p.weapons.map(w => w.name).join() === NAMES.join());

    const pistol = at(p, 'Pistol');
    check('a new player has only the knife and the pistol to wheel between',
        nameOf(p, cycleWeaponIndex(p.weapons, pistol, +1)) === 'Knife' &&
        nameOf(p, cycleWeaponIndex(p.weapons, pistol, -1)) === 'Knife');

    const knife = at(p, 'Knife');
    check('from the knife, previous wraps round the far end to the pistol',
        nameOf(p, cycleWeaponIndex(p.weapons, knife, -1)) === 'Pistol');

    // Everything carried and full, then thin it out.
    p.collectAllGuns();
    check('with everything, next walks the slots in order',
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'Shotgun'), +1)) === 'Rifle' &&
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'Rifle'), -1)) === 'Shotgun');
    check('next from the BFG wraps to the knife',
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'BFG'), +1)) === 'Knife');
    check('previous from the knife wraps to the BFG',
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'Knife'), -1)) === 'BFG');

    p.weapons[at(p, 'Shotgun')].owned = false;
    p.weapons[at(p, 'Rifle')].owned = false;
    check('weapons not carried are skipped',
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'Pistol'), +1)) === 'Rocket Launcher' &&
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'Rocket Launcher'), -1)) === 'Pistol');

    p.ammo.rockets = 0;
    check('a carried weapon with no ammo is skipped',
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'Pistol'), +1)) === 'Plasma Gun');

    p.ammo.cells = 39;
    check('39 cells fire the plasma gun but not the BFG, so the BFG is skipped',
        isWheelSelectable(p.weapons[at(p, 'Plasma Gun')]) &&
        !isWheelSelectable(p.weapons[at(p, 'BFG')]) &&
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'Plasma Gun'), +1)) === 'Knife');

    p.ammo.cells = 0;
    p.ammo.bullets = 0;
    check('with every gun dry the knife still counts, from either side',
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'Pistol'), +1)) === 'Knife' &&
        nameOf(p, cycleWeaponIndex(p.weapons, at(p, 'BFG'), -1)) === 'Knife');
    check('and on the knife with nothing else, the wheel stays put',
        cycleWeaponIndex(p.weapons, at(p, 'Knife'), +1) === at(p, 'Knife') &&
        cycleWeaponIndex(p.weapons, at(p, 'Knife'), -1) === at(p, 'Knife'));

    check('an empty inventory or a zero step goes nowhere',
        cycleWeaponIndex([], 0, 1) === 0 && cycleWeaponIndex(p.weapons, 2, 0) === 2);
}

// =============================================================================
// ACCUMULATION
// =============================================================================

console.log('[Wheel travel in pixels]');
{
    check('pixel mode passes deltaY through', wheelPixels({ deltaY: 100, deltaMode: 0 }) === 100);
    check('line mode scales lines to pixels',
        wheelPixels({ deltaY: 3, deltaMode: 1 }) === 3 * WHEEL.LINE_PX &&
        wheelPixels({ deltaY: -1, deltaMode: 1 }) === -WHEEL.LINE_PX);
    check('a single line is a whole weapon step', WHEEL.LINE_PX >= WHEEL.WEAPON_THRESHOLD_PX);
    check('page mode is far past any threshold', wheelPixels({ deltaY: 1, deltaMode: 2 }) >= WHEEL.WEAPON_THRESHOLD_PX);
    check('a sideways swipe does not count',
        wheelPixels({ deltaX: 120, deltaY: 0, deltaMode: 0 }) === 0);
    check('Shift+wheel, which the browser turns sideways, still counts (Shift is run)',
        wheelPixels({ deltaX: 100, deltaY: 0, deltaMode: 0, shiftKey: true }) === 100);
}

console.log('[Accumulating]');
{
    const acc = new WheelAccumulator(WHEEL.WEAPON_THRESHOLD_PX, WHEEL.WEAPON_COOLDOWN_MS);
    check('one Chrome notch (100 px) is one step down', acc.feed(100, 1000) === 1);
    check('the next notch after the cooldown is one more', acc.feed(100, 1000 + WHEEL.WEAPON_COOLDOWN_MS + 50) === 1);

    acc.reset();
    check('a fat 120 px notch is still one step, not three',
        acc.feed(120, 2000) === 1 && acc.feed(0, 2000 + WHEEL.WEAPON_COOLDOWN_MS + 1) === 0);

    acc.reset();
    check('a Firefox notch of three lines is one step up', acc.feed(wheelPixels({ deltaY: -3, deltaMode: 1 }), 3000) === -1);

    acc.reset();
    let fired = 0;
    let t = 4000;
    for (let i = 0; i < 9; i++) fired += Math.abs(acc.feed(4, t += 16));
    check('a light brush of a trackpad (9 events of 4 px) does nothing', fired === 0);
    fired += Math.abs(acc.feed(4, t += 16));
    check('but the tenth takes it to the threshold and switches once', fired === 1);

    // A one-second swipe: 60 events of 8 px, 480 px in all.
    acc.reset();
    fired = 0;
    t = 6000;
    for (let i = 0; i < 60; i++) fired += Math.abs(acc.feed(8, t += 16));
    const naive = Math.floor(480 / WHEEL.WEAPON_THRESHOLD_PX);
    check(`a long trackpad swipe makes a few switches, not ${naive}`, fired >= 1 && fired <= 6,
        `fired ${fired}`);

    acc.reset();
    acc.feed(30, 8000);
    check('rolling the other way drops travel the old way', acc.feed(-30, 8010) === 0 && acc.feed(-15, 8020) === -1);

    acc.reset();
    acc.feed(30, 9000);
    check('a long pause starts a fresh gesture', acc.feed(30, 9000 + WHEEL.IDLE_RESET_MS + 1) === 0);

    const zoom = new WheelAccumulator(WHEEL.ZOOM_THRESHOLD_PX);
    let steps = 0;
    t = 10000;
    for (let i = 0; i < 30; i++) steps += zoom.feed(-3, t += 16);
    check('a pinch (Chrome: Ctrl+wheel, a few px an event) zooms in steadily, a step per threshold',
        steps === -Math.floor(90 / WHEEL.ZOOM_THRESHOLD_PX), `steps ${steps}`);
}

// =============================================================================
// THE HANDLER
// =============================================================================

/** The listener the handler registered on its surface. */
const listeners = {};
const canvas = {
    ...makeElement('gameCanvas'),
    addEventListener(type, fn, opts) { listeners[type] = { fn, opts }; },
};
const handler = new InputHandler(canvas);
handler.setGameState(gs);

let clock = 100000;
/**
 * A wheel event, spaced well apart from the last so cooldowns are not in play.
 */
function wheel({ deltaY = 0, deltaX = 0, deltaMode = 0, ctrlKey = false, shiftKey = false, inOverlay = false } = {}) {
    clock += 1000;
    const event = {
        deltaY, deltaX, deltaMode, ctrlKey, shiftKey,
        timeStamp: clock,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        target: { closest: (sel) => (inOverlay && sel === '.overlay' ? {} : null) },
    };
    listeners.wheel.fn(event);
    return event;
}

function startPlaying() {
    const p = freshPlayer();
    p.collectAllGuns();
    p.switchWeapon(at(p, 'Pistol'));
    gs.gameRunning = true;
    gs.gameOver = false;
    gs.isLevelCompleting = false;
    gs.awaitingContinue = false;
    gs.playerDeathTimer = -1;
    gs.paused = false;
    return p;
}

console.log('[The listener]');
{
    check('a wheel listener is registered, and not passive', !!listeners.wheel && listeners.wheel.opts?.passive === false);
}

console.log('[Wheel switches weapons]');
{
    const p = startPlaying();
    check('the game is in active play', isActivePlay(gs));

    const down = wheel({ deltaY: 100 });
    check('wheel down selects the next weapon', nameOf(p, p.currentWeaponIndex) === 'Shotgun');
    check('and the page does not scroll', down.defaultPrevented);

    wheel({ deltaY: -100 });
    wheel({ deltaY: -100 });
    check('wheel up twice goes back past the pistol to the knife', nameOf(p, p.currentWeaponIndex) === 'Knife');

    wheel({ deltaY: -100 });
    check('and once more wraps to the BFG', nameOf(p, p.currentWeaponIndex) === 'BFG');

    wheel({ deltaY: 3, deltaMode: 1 });
    check('a notch in lines works the same', nameOf(p, p.currentWeaponIndex) === 'Knife');

    wheel({ deltaX: 100, shiftKey: true });
    check('Shift+wheel (running) still switches', nameOf(p, p.currentWeaponIndex) === 'Pistol');
}

console.log('[Only in active play]');
{
    const cases = [
        ['on the start screen or the tally', () => { gs.gameRunning = false; }],
        ['while paused', () => { gs.pause(); }],
        ['with a paused flag set', () => { gs.paused = true; }],
        ['after game over', () => { gs.gameOver = true; }],
        ['once the exit is reached', () => { gs.isLevelCompleting = true; }],
        ['during the death beat', () => { gs.playerDeathTimer = 30; }],
    ];
    for (const [label, setUp] of cases) {
        const p = startPlaying();
        setUp();
        wheel({ deltaY: 100 });
        check(`no switch ${label}`, nameOf(p, p.currentWeaponIndex) === 'Pistol');
    }

    gs.player = null;
    gs.gameRunning = true;
    let threw = false;
    try { wheel({ deltaY: 100 }); } catch { threw = true; }
    check('no player, no switch and no crash', !threw);
}

console.log('[Ctrl+wheel zooms]');
{
    startPlaying();
    controller.zoomLevel = 1.4;
    const p = gs.player;

    const up = wheel({ deltaY: -100, ctrlKey: true });
    check('Ctrl+wheel up zooms in one step', Math.abs(controller.zoomLevel - 1.5) < 1e-9, `${controller.zoomLevel}`);
    check('and calls preventDefault so the page does not zoom', up.defaultPrevented);
    check('and does not change weapon', nameOf(p, p.currentWeaponIndex) === 'Pistol');

    wheel({ deltaY: 100, ctrlKey: true });
    wheel({ deltaY: 100, ctrlKey: true });
    check('Ctrl+wheel down zooms out, a step a notch', Math.abs(controller.zoomLevel - 1.3) < 1e-9, `${controller.zoomLevel}`);

    for (let i = 0; i < 40; i++) wheel({ deltaY: -100, ctrlKey: true });
    check('zoom stops at the controller\'s maximum', controller.zoomLevel === controller.maxZoom);

    gs.pause();
    controller.zoomLevel = 1.4;
    const paused = wheel({ deltaY: -100, ctrlKey: true });
    check('zoom works while paused, as the - and = keys do',
        Math.abs(controller.zoomLevel - 1.5) < 1e-9 && paused.defaultPrevented);

    // A pinch: Ctrl+wheel in small fractional deltas, a frame apart.
    startPlaying();
    controller.zoomLevel = 1.4;
    for (let i = 0; i < 20; i++) {
        clock += 16;
        listeners.wheel.fn({
            deltaY: -2.5, deltaX: 0, deltaMode: 0, ctrlKey: true, shiftKey: false, timeStamp: clock,
            preventDefault: noop, target: { closest: () => null },
        });
    }
    check('a pinch of 50 px zooms in a sensible two steps',
        Math.abs(controller.zoomLevel - 1.6) < 1e-9, `${controller.zoomLevel}`);
}

console.log('[Overlays keep their wheel]');
{
    const p = startPlaying();
    controller.zoomLevel = 1.4;

    const scroll = wheel({ deltaY: 100, inOverlay: true });
    check('a wheel over an overlay does not switch weapons', nameOf(p, p.currentWeaponIndex) === 'Pistol');
    check('and is not prevented, so the overlay scrolls', !scroll.defaultPrevented);

    const pinch = wheel({ deltaY: -100, ctrlKey: true, inOverlay: true });
    check('Ctrl+wheel over an overlay does not zoom the game behind it', controller.zoomLevel === 1.4);
    check('and is left to the browser', !pinch.defaultPrevented);
}

handler.destroy();

console.log('');
if (failures === 0) {
    console.log('All mouse wheel checks passed.');
} else {
    console.error(`${failures} mouse wheel check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);
