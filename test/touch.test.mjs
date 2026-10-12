// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Touch controls: the stick maths, and the Player driven by the move stick.
 * Run with: npm test
 *
 * The DOM half of js/touch-controls.js is checked in a browser; what is checked
 * here is everything that decides how the game responds -- dead zones, the walk
 * and run ranges, the aim point -- and that the keyboard's movement is exactly
 * what it was with the stick idle.
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

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

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

const touch = await import('../js/touch-controls.js');
const { GameState } = await import('../js/game-state.js');
const { Player } = await import('../js/entities.js');
const { keys, resetInputState } = await import('../js/input-handler.js');
const { TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL } = await import('../js/constants.js');
const { setAlwaysRun } = await import('../js/settings.js');

console.log = origLog;
console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const {
    readStick, dragOrigin, moveDrive, aimPoint, touchDefaultZoom, touchMove,
    STICK_RADIUS: R, MOVE_DEAD_ZONE, FULL_WALK_DEFLECTION, MIN_WALK_THROTTLE, AIM_REACH,
} = touch;

console.log('\n=== touch controls ===\n');

// =============================================================================
// THE STICK
// =============================================================================

console.log('[Reading a stick]');
{
    const centred = readStick(0, 0, R, 0.15);
    check('a thumb that has not moved reads as centred', centred.magnitude === 0 && centred.x === 0 && centred.y === 0);

    const twitch = readStick(R * 0.1, 0, R, 0.15);
    check('a twitch inside the dead zone reads as centred, but the knob still follows',
        twitch.magnitude === 0 && twitch.x === 0 && near(twitch.knobX, R * 0.1));

    const edge = readStick(R * 0.15 + 1e-6, 0, R, 0.15);
    check('output starts from zero at the dead zone\'s edge rather than jumping', edge.magnitude < 1e-6);

    const half = readStick(0, -R * 0.575, R, 0.15);
    check('halfway out of the dead zone reads one half, pointing the right way',
        near(half.magnitude, 0.5, 1e-9) && near(half.y, -0.5, 1e-9) && near(half.x, 0));

    const far = readStick(R * 3, R * 4, R, 0.15);
    check('past the rim the reading is full and the knob stays on the rim',
        far.magnitude === 1 && far.deflection === 1 && near(Math.hypot(far.knobX, far.knobY), R) &&
        near(far.x, 0.6) && near(far.y, 0.8));

    const diag = readStick(R, R, R, 0.15);
    check('diagonals are no faster than straight lines', near(Math.hypot(diag.x, diag.y), 1));
}

console.log('[Floating origin]');
{
    const inside = dragOrigin(100, 100, 120, 100, R);
    check('inside the rim the origin stays put', inside.x === 100 && inside.y === 100);

    const dragged = dragOrigin(100, 100, 100 + R + 30, 100, R);
    check('past the rim the origin follows so the thumb stays on the rim',
        near(dragged.x, 130) && dragged.y === 100);

    const back = readStick(100 + R + 30 - 10 - dragged.x, 0, R, MOVE_DEAD_ZONE);
    check('easing back from over-travel eases off rather than stopping dead',
        back.magnitude > 0.7 && back.magnitude < 1);
}

console.log('[Throttle]');
{
    check('centred drives nothing', moveDrive(0).throttle === 0);
    const nudge = moveDrive(1e-6);
    check('the lightest push walks slowly, not at a crawl from zero',
        near(nudge.throttle, MIN_WALK_THROTTLE, 1e-4));

    const fullAt = (FULL_WALK_DEFLECTION - MOVE_DEAD_ZONE) / (1 - MOVE_DEAD_ZONE);
    check('full pace is reached well short of the rim, and held to it',
        moveDrive(fullAt).throttle > 0.999 && moveDrive(1).throttle === 1);
    check('the stick never runs by itself -- not even at the rim',
        !('run' in moveDrive(1)) && !('run' in moveDrive(fullAt)));

    let rising = true;
    let last = 0;
    for (let m = 0.01; m <= 1; m += 0.01) {
        const t = moveDrive(m).throttle;
        if (t < last) rising = false;
        last = t;
    }
    check('pushing further never walks slower', rising);
}

console.log('[Aim point]');
{
    const p = aimPoint(1, 0, 800, 600, 1.4);
    check('the aim point is AIM_REACH world pixels out, scaled by the zoom',
        near(p.x, 400 + AIM_REACH * 1.4) && near(p.y, 300));
    const q = aimPoint(0, -0.2, 800, 600, 1);
    check('a gentle push aims as far out as a hard one', near(q.y, 300 - AIM_REACH) && near(q.x, 400));
    check('no direction, no aim point', aimPoint(0, 0, 800, 600, 1) === null);
    check('the aim point is past the barrel convergence minimum', AIM_REACH > 60);
}

console.log('[Starting zoom]');
{
    check('a phone, either way up, zooms out to 1.0', touchDefaultZoom(390, 844) === 1 && touchDefaultZoom(844, 390) === 1);
    check('a small phone stops at 0.8', touchDefaultZoom(320, 568) === 0.8);
    check('a tablet keeps the desktop 1.4', touchDefaultZoom(768, 1024) === 1.4);
}

// =============================================================================
// THE PLAYER ON THE STICK
// =============================================================================

console.log('[Player movement]');
{
    const gs = new GameState();
    gs.selectedDifficulty = 'medium';
    gs.gameMap = Array.from({ length: MAP_ROWS }, (_, r) =>
        Array.from({ length: MAP_COLS }, (_, c) =>
            (r < 2 || c < 2 || r >= MAP_ROWS - 2 || c >= MAP_COLS - 2) ? TILE_WALL : TILE_EMPTY));
    gs.enemies = [];
    gs.bullets = [];
    gs.explosions = [];
    gs.barrels = [];
    gs.traps = [];
    gs.temporaryVisualEffects = [];
    globalThis.gameState = gs;

    const centre = (tile) => tile * TILE_SIZE + TILE_SIZE / 2;
    const fresh = () => {
        resetInputState();
        touchMove.x = 0; touchMove.y = 0; touchMove.magnitude = 0;
        const p = new Player(centre(30), centre(24));
        gs.player = p;
        return p;
    };
    const step = (p) => {
        const x = p.x, y = p.y;
        p.handleMovement();
        return { dx: p.x - x, dy: p.y - y };
    };
    const setStick = (dx, dy) => {
        const r = readStick(dx, dy, R, MOVE_DEAD_ZONE);
        touchMove.x = r.x; touchMove.y = r.y; touchMove.magnitude = r.magnitude;
    };

    let p = fresh();
    keys.d = true;
    const walk = step(p);
    keys.d = false;
    check('the keyboard still walks at walking speed', near(walk.dx, p.walkSpeed) && walk.dy === 0,
        `${walk.dx} vs ${p.walkSpeed}`);

    p = fresh();
    keys.w = true; keys.d = true; keys.Shift = true;
    const runDiag = step(p);
    check('a keyboard diagonal run is still normalised', near(Math.hypot(runDiag.dx, runDiag.dy), p.runSpeed) && p.isRunning);
    resetInputState();

    p = fresh();
    setStick(R * 0.5, 0);
    const slow = step(p);
    check('a half push walks east, slower than full walking speed',
        slow.dx > 0 && slow.dx < p.walkSpeed && near(slow.dy, 0) && !p.isRunning && p.isMoving);

    p = fresh();
    setStick(0, R * 0.85);
    const full = step(p);
    check('a firm push walks at full walking speed', near(full.dy, p.walkSpeed) && !p.isRunning,
        `${full.dy} vs ${p.walkSpeed}`);

    p = fresh();
    setStick(-R * 3, -R * 3);
    const rim = step(p);
    check('the rim, even overshot, walks -- it does not run as it once did',
        near(Math.hypot(rim.dx, rim.dy), p.walkSpeed) && rim.dx < 0 && rim.dy < 0 && !p.isRunning,
        `${Math.hypot(rim.dx, rim.dy)} vs ${p.walkSpeed}`);

    // Always Run: the only way to run on a touch screen, and Doom's setting
    // on a keyboard, where it turns Shift into the walk key.
    setAlwaysRun(true);
    try {
        p = fresh();
        setStick(-R, -R);
        const run = step(p);
        check('with Always Run the full stick runs, diagonally, at running speed',
            near(Math.hypot(run.dx, run.dy), p.runSpeed) && run.dx < 0 && run.dy < 0 && p.isRunning);

        p = fresh();
        setStick(R * 0.5, 0);
        const halfRun = step(p);
        check('and a half push runs slower than that, as it walked slower before',
            halfRun.dx > p.walkSpeed * MIN_WALK_THROTTLE && halfRun.dx < p.runSpeed && p.isRunning);

        p = fresh();
        keys.d = true;
        const keyRun = step(p);
        check('the keyboard runs without Shift', near(keyRun.dx, p.runSpeed) && p.isRunning);
        keys.Shift = true;
        const keyWalk = step(p);
        check('and Shift walks, as in Doom', near(keyWalk.dx, p.walkSpeed) && !p.isRunning);
    } finally {
        resetInputState();
        setAlwaysRun(false);
    }

    p = fresh();
    setStick(R * 0.05, 0);
    const still = step(p);
    check('a thumb resting in the dead zone does not creep', still.dx === 0 && still.dy === 0 && !p.isMoving);

    p = fresh();
    setStick(-R, 0);
    keys.d = true;
    const both = step(p);
    keys.d = false;
    check('a held key overrides the stick', near(both.dx, p.walkSpeed) && !p.isRunning);

    fresh();
}

console.log('');
if (failures > 0) {
    console.error(`${failures} touch check(s) failed.`);
    process.exit(1);
}
console.log('All touch checks passed.');
