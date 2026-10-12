// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Game controllers (js/gamepad.js): reading a controller, presses and held
 * repeats, and a live game driven by a fake one -- moving, running, aiming,
 * firing, weapons, zoom, the map, pause, rumble -- and the menus.
 * Run with: node test/run.mjs
 *
 * A real controller is checked by hand; what is checked here is every decision
 * between the Gamepad API's numbers and the game.
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

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- DOM stubs
// One element per id, kept, so what the pause menu shows is what the
// controller sees.
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

function makeClassList(initial = []) {
    const set = new Set(initial);
    return {
        add: (...c) => c.forEach(x => set.add(x)),
        remove: (...c) => c.forEach(x => set.delete(x)),
        toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)),
        contains: (c) => set.has(c),
    };
}

const elements = new Map();
const doc = {
    activeElement: null,
    body: { classList: makeClassList() },
    getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    },
    querySelector: (s) => makeElement(s),
    querySelectorAll(selector) {
        if (selector === '.pad-focus') return [...elements.values(), ...allButtons].filter(e => e.classList.contains('pad-focus'));
        return [];
    },
    createElement: () => makeElement('created'),
    addEventListener: noop, removeEventListener: noop, hidden: false,
};
const allButtons = [];

function makeElement(id, extra = {}) {
    const el = {
        id, style: {}, dataset: {}, textContent: '', innerHTML: '', value: '',
        width: 1200, height: 800, complete: true, naturalHeight: 64,
        classList: makeClassList(),
        clicks: 0,
        buttons: [],
        addEventListener: noop, removeEventListener: noop,
        setAttribute: noop, getAttribute: () => null,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
        getContext: () => makeCtx(),
        querySelector: () => null,
        querySelectorAll: (sel) => (sel === 'button' ? el.buttons : []),
        appendChild: noop,
        focus() { doc.activeElement = el; },
        blur() { if (doc.activeElement === el) doc.activeElement = null; },
        click() { el.clicks++; el.onClick?.(); },
        scrolled: 0,
        scrollBy(opts) { el.scrolled += opts.top; },
        ...extra,
    };
    return el;
}

globalThis.window = globalThis;
globalThis.document = doc;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.Image = class { constructor() { this.complete = true; this.naturalHeight = 64; } addEventListener() {} };

// The menus start hidden
for (const id of ['instructionsOverlay', 'pauseOverlay', 'messageOverlay', 'loadingOverlay', 'cheatCodeForm']) {
    doc.getElementById(id).style.display = 'none';
}

const origLog = console.log;
const origWarn = console.warn;
const quiet = (fn) => {
    console.log = noop; console.warn = noop;
    try { return fn(); } finally { console.log = origLog; console.warn = origWarn; }
};

console.log = noop; console.warn = noop;
const pads = await (async () => ({
    gamepad: await import('../js/gamepad.js'),
    touch: await import('../js/touch-controls.js'),
    input: await import('../js/input-handler.js'),
    pause: await import('../js/pause-menu.js'),
    settings: await import('../js/settings.js'),
    GameState: (await import('../js/game-state.js')).GameState,
    Player: (await import('../js/entities.js')).Player,
    constants: await import('../js/constants.js'),
}))();
console.log = origLog; console.warn = origWarn;
const { BUTTON, PAD, ButtonEdges, readPad, stepFocus, menuButtons, GamepadController } = pads.gamepad;
const { touchMove, aimPoint } = pads.touch;
const { mouse, pad, keys, resetInputState } = pads.input;
const { TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_WALL } = pads.constants;

/** A controller as navigator.getGamepads() reports one */
function fakePad({ buttons = {}, axes = [0, 0, 0, 0], index = 0 } = {}) {
    const list = Array.from({ length: 17 }, (_, i) => {
        const v = buttons[i] ?? 0;
        return { pressed: v === true || v >= 0.5, value: typeof v === 'number' ? v : (v ? 1 : 0) };
    });
    const rumbles = [];
    return {
        index, connected: true, mapping: 'standard', id: 'Test Pad', buttons: list, axes,
        rumbles,
        vibrationActuator: { playEffect: (type, params) => { rumbles.push({ type, ...params }); return Promise.resolve(); } },
    };
}

console.log('\n=== game controllers ===\n');

// =============================================================================
// READING A CONTROLLER
// =============================================================================

console.log('[Presses and held directions]');
{
    const edges = new ButtonEdges();
    const down = (i) => { const p = []; p[i] = true; for (let k = 0; k < 17; k++) p[k] = !!p[k]; return p; };
    const none = Array(17).fill(false);

    check('a button fires on the frame it goes down', edges.update(down(BUTTON.A), 0).has(BUTTON.A));
    check('and not again while held', !edges.update(down(BUTTON.A), 16).has(BUTTON.A) &&
        !edges.update(down(BUTTON.A), 2000).has(BUTTON.A));
    edges.update(none, 2016);
    check('released and pressed again, it fires again', edges.update(down(BUTTON.A), 2032).has(BUTTON.A));

    edges.reset();
    edges.update(down(BUTTON.DOWN), 0);
    check('a held menu direction waits before repeating', !edges.update(down(BUTTON.DOWN), PAD.REPEAT_DELAY_MS - 1).has(BUTTON.DOWN));
    check('then repeats', edges.update(down(BUTTON.DOWN), PAD.REPEAT_DELAY_MS).has(BUTTON.DOWN));
    check('at its rate, not every frame',
        !edges.update(down(BUTTON.DOWN), PAD.REPEAT_DELAY_MS + 16).has(BUTTON.DOWN) &&
        edges.update(down(BUTTON.DOWN), PAD.REPEAT_DELAY_MS + PAD.REPEAT_RATE_MS).has(BUTTON.DOWN));
}

console.log('[Sticks and triggers]');
{
    const drift = readPad(fakePad({ axes: [0.12, -0.1, 0.15, 0.18] }));
    check('a resting stick\'s drift reads as nothing', drift.move.magnitude === 0 && drift.aim.magnitude === 0);

    const full = readPad(fakePad({ axes: [1, 0, 0, -1] }));
    check('a full push reads full, the right way', near(full.move.magnitude, 1) && near(full.move.x, 1) &&
        near(full.aim.y, -1));

    const diag = readPad(fakePad({ axes: [0.7071, 0.7071, 0, 0] }));
    check('a diagonal is as far as a straight push (radial dead zone)', near(diag.move.magnitude, full.move.magnitude, 1e-3));

    check('a trigger counts once pulled past its threshold',
        readPad(fakePad({ buttons: { [BUTTON.RT]: 0.5 } })).pressed[BUTTON.RT] &&
        !readPad(fakePad({ buttons: { [BUTTON.RT]: 0.2 } })).pressed[BUTTON.RT]);

    const stickDown = readPad(fakePad({ axes: [0, 0.9, 0, 0] }));
    check('in menus the left stick stands in for the D-pad',
        stickDown.menuPressed[BUTTON.DOWN] && !stickDown.pressed[BUTTON.DOWN]);
}

console.log('[Stepping through a menu]');
{
    check('down from nothing lands on the first', stepFocus(4, -1, 1) === 0);
    check('up from nothing lands on the last', stepFocus(4, -1, -1) === 3);
    check('it wraps both ways', stepFocus(4, 3, 1) === 0 && stepFocus(4, 0, -1) === 3);
    check('an empty menu has nowhere to go', stepFocus(0, -1, 1) === -1);

    const shown = makeElement('a');
    const hidden = makeElement('b', { style: { display: 'none' } });
    const disabled = makeElement('c', { disabled: true });
    const overlay = makeElement('o', { buttons: [shown, hidden, disabled] });
    const list = menuButtons(overlay);
    check('hidden and disabled buttons are skipped', list.length === 1 && list[0] === shown);
}

// =============================================================================
// PLAYING WITH ONE
// =============================================================================

const gs = new pads.GameState();
gs.selectedDifficulty = 'medium';
gs.gameMap = Array.from({ length: MAP_ROWS }, (_, r) =>
    Array.from({ length: MAP_COLS }, (_, c) =>
        (r < 2 || c < 2 || r >= MAP_ROWS - 2 || c >= MAP_COLS - 2) ? TILE_WALL : TILE_EMPTY));
Object.assign(gs, { enemies: [], bullets: [], explosions: [], barrels: [], traps: [], temporaryVisualEffects: [] });
globalThis.gameState = gs;

let zoomIns = 0, zoomOuts = 0;
const controller = {
    gameState: gs,
    canvas: { width: 1200, height: 800 },
    zoomLevel: 1.4,
    zoomIn: () => { zoomIns++; },
    zoomOut: () => { zoomOuts++; },
    showStartScreen: noop,
};
globalThis.gameController = controller;
quiet(() => pads.pause.initPauseMenu(controller, { doc }));

let current = fakePad();
const ctl = new GamepadController(controller, { getPads: () => [current], doc, now: () => clock });
let clock = 0;
const frame = (padState) => { current = padState; clock += 16; quiet(() => ctl.poll()); };

const centre = (tile) => tile * TILE_SIZE + TILE_SIZE / 2;
function freshPlay() {
    resetInputState();
    touchMove.x = 0; touchMove.y = 0; touchMove.magnitude = 0;
    gs.player = new pads.Player(centre(30), centre(24));
    gs.gameRunning = true;
    gs.gameOver = false;
    gs.paused = false;
    gs.isLevelCompleting = false;
    frame(fakePad());   // let go of anything from before
    return gs.player;
}
const step = (p) => { const x = p.x, y = p.y; quiet(() => p.handleMovement()); return { dx: p.x - x, dy: p.y - y }; };

console.log('[Moving and running]');
{
    let p = freshPlay();
    frame(fakePad({ axes: [1, 0, 0, 0] }));
    const walk = step(p);
    check('the left stick pushed fully walks, at walking speed', near(walk.dx, p.walkSpeed) && !p.isRunning,
        `${walk.dx} vs ${p.walkSpeed}`);

    frame(fakePad({ axes: [1, 0, 0, 0], buttons: { [BUTTON.LT]: 1 } }));
    const run = step(p);
    check('holding LT runs', near(run.dx, p.runSpeed) && p.isRunning && pad.run);

    frame(fakePad());
    check('letting go stops him and lets go of run', touchMove.magnitude === 0 && !pad.run && step(p).dx === 0);

    pads.settings.setAlwaysRun(true);
    try {
        frame(fakePad({ axes: [0, 1, 0, 0] }));
        check('with Always Run the stick runs', near(step(p).dy, p.runSpeed));
        frame(fakePad({ axes: [0, 1, 0, 0], buttons: { [BUTTON.LT]: 1 } }));
        check('and LT walks, as Shift does', near(step(p).dy, p.walkSpeed));
    } finally {
        pads.settings.setAlwaysRun(false);
        frame(fakePad());
    }

    keys.d = true;
    frame(fakePad());
    check('an idle controller leaves a held key alone', keys.d === true);
    keys.d = false;
}

console.log('[Aiming and firing]');
{
    freshPlay();
    frame(fakePad({ axes: [0, 0, -1, 0] }));
    const expected = aimPoint(-1, 0, 1200, 800, 1.4);
    check('the right stick aims: the aim point goes out along it', near(mouse.x, expected.x) && near(mouse.y, expected.y));
    check('without firing', mouse.down === false);

    frame(fakePad({ axes: [0, 0, -1, 0], buttons: { [BUTTON.RT]: 1 } }));
    check('RT fires', mouse.down === true);
    frame(fakePad({ axes: [0, 0, -1, 0] }));
    check('and letting go stops', mouse.down === false);

    frame(fakePad({ axes: [0, 1, 0, 0] }));
    const facing = aimPoint(0, 1, 1200, 800, 1.4);
    check('with the right stick at rest he faces the way he walks', near(mouse.x, facing.x) && near(mouse.y, facing.y));

    ctl.yieldAim();
    mouse.x = 5; mouse.y = 5;
    frame(fakePad({ axes: [1, 0, 0, 0] }));
    check('once the mouse has moved, walking leaves its aim alone', mouse.x === 5 && mouse.y === 5);

    mouse.down = true;   // the mouse button, held
    frame(fakePad());
    check('an idle controller never lets go of the mouse button', mouse.down === true);
    mouse.down = false;
}

console.log('[Weapons, zoom and the map]');
{
    const p = freshPlay();
    p.collectAllGuns();
    p.switchWeapon(1);
    frame(fakePad({ buttons: { [BUTTON.RB]: 1 } }));
    check('RB selects the next weapon', p.currentWeaponIndex === 2, `${p.currentWeaponIndex}`);
    frame(fakePad({ buttons: { [BUTTON.RB]: 1 } }));
    check('holding it does not keep switching', p.currentWeaponIndex === 2);
    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.LB]: 1 } }));
    check('LB the previous', p.currentWeaponIndex === 1);
    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.RIGHT]: 1 } }));
    check('D-pad right the next too', p.currentWeaponIndex === 2);

    frame(fakePad());
    const before = [zoomIns, zoomOuts];
    frame(fakePad({ buttons: { [BUTTON.UP]: 1 } }));
    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.DOWN]: 1 } }));
    check('D-pad up and down zoom in and out', zoomIns === before[0] + 1 && zoomOuts === before[1] + 1);

    frame(fakePad());
    const map = gs.showMinimap;
    frame(fakePad({ buttons: { [BUTTON.Y]: 1 } }));
    check('Y toggles the minimap', gs.showMinimap === !map);
    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.BACK]: 1 } }));
    check('and so does Back', gs.showMinimap === map);
    frame(fakePad());
}

console.log('[Rumble]');
{
    const p = freshPlay();
    const hurt = fakePad();
    frame(hurt);
    quiet(() => p.takeDamage(10));
    frame(hurt);
    check('a hit rumbles the controller', hurt.rumbles.length === 1 && hurt.rumbles[0].type === 'dual-rumble');
    frame(hurt);
    check('once', hurt.rumbles.length === 1);
    p.godMode = true;
    quiet(() => p.takeDamage(10));
    frame(hurt);
    check('a hit god mode turns away does not', hurt.rumbles.length === 1);
}

console.log('[Pause]');
{
    freshPlay();
    frame(fakePad({ axes: [1, 0, 0, 0], buttons: { [BUTTON.RT]: 1 } }));
    frame(fakePad({ axes: [1, 0, 0, 0], buttons: { [BUTTON.RT]: 1, [BUTTON.START]: 1 } }));
    const menu = pads.pause.pauseMenu;
    check('Start pauses', menu.paused && gs.paused);
    check('and lets go of the stick and the trigger', touchMove.magnitude === 0 && mouse.down === false);

    frame(fakePad({ axes: [1, 0, 0, 0], buttons: { [BUTTON.RT]: 1 } }));
    check('nothing held reaches the game while the menu is up', touchMove.magnitude === 0 && mouse.down === false);

    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.B]: 1 } }));
    check('B in the pause menu resumes', !menu.paused && gs.gameRunning);

    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.START]: 1 } }));
    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.START]: 1 } }));
    check('Start in the pause menu resumes too', !menu.paused && gs.gameRunning);

    frame(fakePad());
    current = fakePad();
    quiet(() => ctl.disconnected(current.index));
    check('a controller dropping out mid-level pauses the game', menu.paused);
    quiet(() => menu.resume());
}

// =============================================================================
// MENUS
// =============================================================================

console.log('[Menus]');
{
    gs.gameRunning = false;
    const overlay = doc.getElementById('messageOverlay');
    overlay.style.display = 'flex';
    const easy = makeElement('easy', { classList: makeClassList(['difficulty-button']) });
    const start = makeElement('restartButton', { classList: makeClassList(['game-button']) });
    const help = makeElement('instructionsButton', { classList: makeClassList(['game-button', 'secondary']) });
    overlay.buttons = [easy, start, help];
    allButtons.push(easy, start, help);
    doc.activeElement = null;

    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.A]: 1 } }));
    check('A with nothing chosen presses the main button (Start Game)', start.clicks === 1 && easy.clicks === 0);

    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.DOWN]: 1 } }));
    check('down moves to the first button', doc.activeElement === easy && easy.classList.contains('pad-focus'));
    frame(fakePad());
    frame(fakePad({ axes: [0, 0.9, 0, 0] }));
    check('the left stick moves too, and the mark follows',
        doc.activeElement === start && start.classList.contains('pad-focus') && !easy.classList.contains('pad-focus'));
    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.A]: 1 } }));
    check('A presses the chosen one', start.clicks === 2);

    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.UP]: 1 } }));
    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.UP]: 1 } }));
    check('up wraps from the first to the last', doc.activeElement === help);

    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.START]: 1 } }));
    check('Start presses the main button whatever is chosen', start.clicks === 3 && help.clicks === 0);

    // The instructions over the start screen
    const instructions = doc.getElementById('instructionsOverlay');
    instructions.style.display = 'flex';
    const content = makeElement('content');
    instructions.querySelector = (sel) => (sel === '.modal-content' ? content : null);
    const close = doc.getElementById('closeInstructionsButton');
    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.DOWN]: 1 } }));
    check('in the instructions, down scrolls', content.scrolled === PAD.SCROLL_PX && start.clicks === 3);
    frame(fakePad());
    frame(fakePad({ buttons: { [BUTTON.B]: 1 } }));
    check('and B closes them', close.clicks === 1);
    instructions.style.display = 'none';
    overlay.style.display = 'none';
}

console.log('');
if (failures === 0) {
    console.log('All controller checks passed.');
    process.exit(0);
} else {
    console.error(`${failures} controller check(s) FAILED.`);
    process.exit(1);
}
