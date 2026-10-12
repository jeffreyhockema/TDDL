// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * The pause menu, Esc, fullscreen and silent menus. Run with: npm test
 *
 * Drives the real GameState, InputHandler, touch controls and audio engine
 * through js/pause-menu.js, with a small fake DOM that remembers what it is
 * told -- which elements are shown, which have focus, which listeners were
 * added -- and a fake AudioContext that records where the master gain is sent.
 *
 * What is checked is what the player would notice going wrong:
 *   - Esc pauses play and resumes it, closes the code box without resuming,
 *     and does nothing at all on the start screen, the tally or Game Over;
 *   - held keys, the mouse button and the touch sticks are let go on pause;
 *   - the level does not move on while paused, and does again after;
 *   - the game is silent while paused and on every menu, sounds already
 *     playing are cut, and the sound comes back on resume;
 *   - fullscreen calls the API (or its webkit spelling), its controls say
 *     which way they would go, they are hidden where it is unsupported, and
 *     the browser's own Esc out of fullscreen neither pauses nor resumes.
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

// ---------------------------------------------------------------- the clock
// The fullscreen Esc grace period is timed; driving the clock by hand is the
// only way to step past it without waiting.
let clock = 1000;
Object.defineProperty(globalThis, 'performance', {
    value: { now: () => clock },
    configurable: true,
    writable: true,
});

// ---------------------------------------------------------------- fake DOM
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

/**
 * Builds a fake document. Separate documents are needed for the fullscreen
 * variants (standard, webkit-only, none), so this is a factory.
 *
 * @param {Object} [fullscreen] - Which fullscreen API to give it:
 *        { standard: true } | { webkit: true } | {} for none
 */
function makeDocument(fullscreen = { standard: true }) {
    const registry = new Map();
    const docListeners = {};
    const calls = { request: 0, webkitRequest: 0, exit: 0, webkitExit: 0 };

    const doc = {
        hidden: false,
        activeElement: null,
        fullscreenElement: null,
        calls,
        addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
        removeEventListener: noop,
        dispatch: (type) => (docListeners[type] || []).forEach(fn => fn({ type })),
        createElement: () => makeElement('created'),
        getElementById: (id) => {
            if (!registry.has(id)) registry.set(id, makeElement(id));
            return registry.get(id);
        },
        querySelector: (s) => makeElement(s),
        querySelectorAll: (selector) => {
            const all = [...registry.values()];
            if (selector === '[data-game-action]') return all.filter(e => e.dataset.gameAction);
            if (selector === '[data-fullscreen-toggle]') return all.filter(e => e.fullscreenToggle);
            return [];
        },
    };

    function makeElement(id, extra = {}) {
        const listeners = {};
        const el = {
            id, style: {}, dataset: {}, hidden: false, textContent: '', innerHTML: '', value: '',
            title: '', attributes: {}, width: 1200, height: 800, complete: true, naturalHeight: 64,
            classList: makeClassList(),
            addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
            removeEventListener: noop,
            dispatch(type, event = {}) {
                const e = { type, target: el, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...event };
                (listeners[type] || []).forEach(fn => fn(e));
                return e;
            },
            click() { return el.dispatch('click'); },
            focus() { doc.activeElement = el; },
            blur() { if (doc.activeElement === el) doc.activeElement = doc.body; },
            select: noop,
            setAttribute(name, value) { el.attributes[name] = String(value); },
            getAttribute(name) { return el.attributes[name] ?? null; },
            contains: (other) => other === el,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
            getContext: () => makeCtx(),
            querySelector: () => makeElement('child'),
            querySelectorAll: () => [],
            appendChild: noop,
            hasPointerCapture: () => false,
            ...extra,
        };
        return el;
    }

    doc.body = makeElement('body');
    doc.activeElement = doc.body;

    const root = makeElement('html');
    if (fullscreen.standard) {
        doc.fullscreenEnabled = true;
        root.requestFullscreen = async () => {
            calls.request++;
            doc.fullscreenElement = root;
            doc.dispatch('fullscreenchange');
        };
        doc.exitFullscreen = async () => {
            calls.exit++;
            doc.fullscreenElement = null;
            doc.dispatch('fullscreenchange');
        };
    } else if (fullscreen.webkit) {
        doc.webkitFullscreenEnabled = true;
        root.webkitRequestFullscreen = () => {
            calls.webkitRequest++;
            doc.webkitFullscreenElement = root;
            doc.dispatch('webkitfullscreenchange');
        };
        doc.webkitExitFullscreen = () => {
            calls.webkitExit++;
            doc.webkitFullscreenElement = null;
            doc.dispatch('webkitfullscreenchange');
        };
    }
    doc.documentElement = root;

    // The markup the pause menu works with: the top-right buttons (the
    // desktop's, and the touch row's fullscreen), and the menu's own.
    const tag = (id, props) => Object.assign(doc.getElementById(id), props);
    tag('cornerPause', { dataset: { gameAction: 'pause' } });
    tag('cornerFullscreen', { dataset: { gameAction: 'fullscreen' }, fullscreenToggle: true });
    tag('touchFullscreen', { dataset: { touchAction: 'fullscreen' }, fullscreenToggle: true });
    tag('pauseFullscreenButton', { fullscreenToggle: true });
    tag('pauseOverlay', { style: { display: 'none' } });
    tag('cheatCodeForm', { style: { display: 'none' } });
    tag('cheatCodeInput', { tagName: 'INPUT' });
    const menuIds = ['pauseResumeButton', 'pauseCodeButton', 'pauseFullscreenButton', 'pauseRunButton', 'pauseQuitButton',
                     'cheatCodeForm', 'cheatCodeInput'];
    doc.getElementById('pauseOverlay').contains = (other) => menuIds.includes(other?.id);
    return doc;
}

// ---------------------------------------------------------------- animation frames
// A queue run by hand, so the game loop advances exactly when a test says. The
// loop steps by elapsed time, not by frames, so each frame also moves a clock
// (the hand-driven one above) on by one 60 Hz frame -- run back to back without
// it, the frames would arrive no time apart and owe the simulation nothing.
const frames = new Map();
let nextFrame = 1;
globalThis.requestAnimationFrame = (fn) => { const id = nextFrame++; frames.set(id, fn); return id; };
globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
function runFrames(count) {
    for (let i = 0; i < count; i++) {
        clock += 1000 / 60;
        const batch = [...frames.values()];
        frames.clear();
        batch.forEach(fn => fn());
    }
}

// ---------------------------------------------------------------- fake Web Audio
class FakeParam {
    constructor(value) { this.value = value; this.target = value; }
    setValueAtTime(v) { this.value = v; this.target = v; return this; }
    linearRampToValueAtTime(v) { this.target = v; return this; }
    exponentialRampToValueAtTime(v) { this.target = v; return this; }
    setTargetAtTime(v) { this.target = v; return this; }
    cancelScheduledValues() { return this; }
}
function fakeNode(extra = {}) {
    return {
        disconnected: false,
        connect(target) { return target; },
        disconnect() { this.disconnected = true; },
        start: noop, stop: noop,
        ...extra,
    };
}
const contexts = [];
class FakeAudioContext {
    constructor() {
        this.state = 'suspended';
        this.currentTime = 0;
        this.sampleRate = 44100;
        this.destination = fakeNode();
        this.gains = [];
        contexts.push(this);
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    decodeAudioData(_bytes, _resolve, reject) { reject(new Error('not decoded under test')); }
    createGain() { const n = fakeNode({ gain: new FakeParam(1) }); this.gains.push(n); return n; }
    createBiquadFilter() { return fakeNode({ frequency: new FakeParam(350), Q: new FakeParam(1), gain: new FakeParam(0) }); }
    createDynamicsCompressor() {
        return fakeNode({ threshold: new FakeParam(0), knee: new FakeParam(0), ratio: new FakeParam(0),
                          attack: new FakeParam(0), release: new FakeParam(0) });
    }
    createWaveShaper() { return fakeNode({ curve: null, oversample: 'none' }); }
    createConvolver() { return fakeNode({ buffer: null }); }
    createStereoPanner() { return fakeNode({ pan: new FakeParam(0) }); }
    createOscillator() { return fakeNode({ frequency: new FakeParam(440), detune: new FakeParam(0) }); }
    createBufferSource() { return fakeNode({ playbackRate: new FakeParam(1), buffer: null, loop: false }); }
    createBuffer(channels, length, sampleRate) {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return { length, sampleRate, duration: length / sampleRate, numberOfChannels: channels, getChannelData: i => data[i] };
    }
}
globalThis.AudioContext = FakeAudioContext;
globalThis.fetch = async () => ({ ok: false, status: 404 });

// ---------------------------------------------------------------- globals
const doc = makeDocument({ standard: true });
globalThis.window = globalThis;
globalThis.document = doc;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.Image = class { constructor() { this.complete = true; this.naturalHeight = 64; } addEventListener() {} };

// Warnings are expected here and all of them are noise: no sound file loads
// under test, and a refused fullscreen request is meant to be shrugged off.
// Several arrive from promises after the code that caused them has returned,
// so they are muted for the whole suite rather than call by call.
console.warn = noop;
const origLog = console.log;
const quiet = (fn) => {
    console.log = noop;
    try { return fn(); } finally { console.log = origLog; }
};

console.log = noop;
const { GameState } = await import('../js/game-state.js');
const { InputHandler, keys, mouse } = await import('../js/input-handler.js');
const { PauseMenu, initPauseMenu, FULLSCREEN_ESC_GRACE_MS } = await import('../js/pause-menu.js');
const { initTouchControls } = await import('../js/touch-controls.js');
const fullscreen = await import('../js/fullscreen.js');
const { setAlwaysRun, isAlwaysRun } = await import('../js/settings.js');
const audio = await import('../js/audio-system.js');
const engine = await import('../js/audio-engine.js');
console.log = origLog;

globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

// ---------------------------------------------------------------- the rig
const canvas = doc.getElementById('gameCanvas');
const gs = new GameState();
const inputHandler = new InputHandler(canvas);
inputHandler.setGameState(gs);

let startScreens = 0;
const controller = {
    gameState: gs,
    inputHandler,
    canvas,
    zoomLevel: 1,
    zoomIn: noop,
    zoomOut: noop,
    showStartScreen() { startScreens++; gs.showStartScreen(); },
};
controller.touchControls = quiet(() => initTouchControls(controller));
const menu = quiet(() => initPauseMenu(controller));

const overlay = doc.getElementById('pauseOverlay');
const codeForm = doc.getElementById('cheatCodeForm');
const codeInput = doc.getElementById('cheatCodeInput');
const menuShown = () => overlay.style.display === 'flex';

/** A key press, through the same path a real one takes. */
function press(key, target = doc.activeElement || doc.body, extra = {}) {
    const event = { key, target, repeat: false, ctrlKey: false, altKey: false, metaKey: false,
                    defaultPrevented: false, ...extra };
    event.preventDefault = () => { event.defaultPrevented = true; };
    quiet(() => inputHandler.handleKeyDown(event));
    return event;
}

/** Starts a fresh level and lets it run a few frames. */
function play() {
    quiet(() => {
        gs.reset();
        gs.startGame();
        gs.startGameLoop();
        runFrames(3);
    });
}

console.log('\n=== pause menu ===\n');

// =============================================================================
// ESC ON SCREENS THAT ARE NOT PLAY
// =============================================================================

console.log('[Esc off the playfield]');
{
    quiet(() => gs.showStartScreen());
    const event = press('Escape');
    check('the start screen: Esc does not pause', !menu.paused && !gs.paused && !menuShown());
    check('and starts nothing', !gs.gameRunning && frames.size <= 1);
    check('and is not claimed, so nothing else is blocked', !event.defaultPrevented);

    play();
    quiet(() => gs.levelComplete());
    const tallyFrames = gs.levelStats.frames;
    press('Escape');
    runFrames(3);
    check('the level tally: Esc does nothing', !menu.paused && !menuShown() && gs.awaitingContinue);
    check('and does not start the next level', !gs.gameRunning && gs.levelStats.frames === tallyFrames);

    play();
    quiet(() => gs.showGameOverScreen());
    press('Escape');
    check('Game Over: Esc does nothing', !menu.paused && !menuShown() && !gs.gameRunning && gs.gameOver);
    check('and a stray resume() cannot bring the dead run back', quiet(() => gs.resume()) === false && !gs.gameRunning);
}

// =============================================================================
// ESC IN PLAY
// =============================================================================

console.log('[Esc pauses and resumes]');
{
    play();
    check('a level is being played', gs.gameRunning && menu.isPlaying());

    keys.w = true;
    keys.Shift = true;
    mouse.down = true;
    let released = 0;
    const realRelease = controller.touchControls.releaseAll.bind(controller.touchControls);
    controller.touchControls.releaseAll = () => { released++; realRelease(); };

    const event = press('Escape');
    check('Esc in play pauses', menu.paused && gs.paused && !gs.gameRunning);
    check('and shows the pause menu', menuShown());
    check('and claims the key', event.defaultPrevented);
    check('held keys are let go', !keys.w && !keys.Shift);
    check('the mouse button is let go', mouse.down === false);
    check('the touch sticks are let go', released === 1);
    check('Resume has the keyboard, so Enter resumes', doc.activeElement === doc.getElementById('pauseResumeButton'));

    const frozen = gs.levelStats.frames;
    const playerAt = { x: gs.player.x, y: gs.player.y };
    runFrames(10);
    check('the level does not move on while paused', gs.levelStats.frames === frozen,
        `${frozen} -> ${gs.levelStats.frames}`);
    check('the player stays put', gs.player.x === playerAt.x && gs.player.y === playerAt.y);
    check('Esc held down does not flicker the menu', (press('Escape', doc.body, { repeat: true }), menu.paused));

    press('Escape');
    check('Esc again resumes', !menu.paused && !gs.paused && gs.gameRunning && !menuShown());
    quiet(() => runFrames(3));
    // Resuming runs one step at once, then one per frame
    check('and the level moves on again', gs.levelStats.frames === frozen + 4, `${frozen} -> ${gs.levelStats.frames}`);

    controller.touchControls.releaseAll = realRelease;
}

console.log('[The buttons]');
{
    play();
    quiet(() => doc.getElementById('cornerPause').click());
    check('the top-right pause button pauses', menu.paused && menuShown());
    quiet(() => doc.getElementById('pauseResumeButton').click());
    check('Resume resumes', !menu.paused && gs.gameRunning && !menuShown());

    quiet(() => controller.touchControls.runAction('pause'));
    check('the touch row\'s pause button opens the same menu', menu.paused && menuShown());
    quiet(() => doc.getElementById('pauseResumeButton').click());

    quiet(() => doc.getElementById('cornerPause').click());
    quiet(() => doc.getElementById('pauseQuitButton').click());
    check('Main Menu leaves for the start screen', startScreens === 1 && !menuShown() && !menu.paused);
    check('and the run is abandoned, not held', !gs.paused && !gs.gameRunning);
    press('Escape');
    check('after which Esc does nothing', !menu.paused && !gs.gameRunning);
    check('and the pause button cannot pause a menu', (quiet(() => doc.getElementById('cornerPause').click()), !menu.paused));
}

console.log('[Always Run]');
{
    const button = doc.getElementById('pauseRunButton');
    setAlwaysRun(false);
    menu.syncAlwaysRun();
    check('the button says Always Run is off to begin with',
        button.textContent === 'Always Run: Off' && button.getAttribute('aria-pressed') === 'false');
    quiet(() => button.click());
    check('a click turns it on, and the button says so',
        isAlwaysRun() && button.textContent === 'Always Run: On' && button.getAttribute('aria-pressed') === 'true');
    quiet(() => button.click());
    check('another turns it off again', !isAlwaysRun() && button.textContent === 'Always Run: Off');
}

console.log('[The code box]');
{
    play();
    press('Escape');
    quiet(() => doc.getElementById('pauseCodeButton').click());
    check('Enter Code opens the box and gives it the keyboard',
        codeForm.style.display === 'block' && doc.activeElement === codeInput);

    const typed = press('w', codeInput);
    check('typing in it does not walk', !keys.w && !typed.defaultPrevented);

    press('Escape', codeInput);
    check('Esc in the box closes the box', codeForm.style.display === 'none');
    check('but does not resume', menu.paused && menuShown());

    press('Escape');
    check('a second Esc resumes', !menu.paused && gs.gameRunning);

    press('Escape');
    quiet(() => doc.getElementById('pauseCodeButton').click());
    codeInput.value = 'nonsense';
    quiet(() => codeForm.dispatch('submit'));
    check('a wrong code stays put', menu.paused &&
        doc.getElementById('cheatCodeNote').textContent === 'Nothing happens.');

    codeInput.value = 'iddqd';
    quiet(() => codeForm.dispatch('submit'));
    check('a right code works and resumes', gs.player.godMode === true && !menu.paused && gs.gameRunning,
        `god ${gs.player.godMode}, paused ${menu.paused}`);
}

// =============================================================================
// SOUND
// =============================================================================

console.log('[Silent menus]');
{
    await quiet(() => audio.ensureAudioAndSynths());
    const ctx = contexts[contexts.length - 1];
    const master = ctx?.gains[0];
    check('audio runs under test', audio.getAudioState() === 'running' && !!master);

    quiet(() => gs.showStartScreen());
    check('the start screen is silent', audio.isMenuSilenced() && !audio.isAudioReady());
    check('nothing can start on it', engine.voice({ dur: 0.1 }) === null);
    check('the master is sent to nothing', master.gain.target === 0);

    play();
    check('play is heard', !audio.isMenuSilenced() && audio.isAudioReady() && master.gain.target > 0);
    const ringing = engine.voice({ dur: 2 });
    check('a sound can start in play', ringing !== null);

    press('Escape');
    check('paused, the game is silent', audio.isMenuSilenced() && !audio.isAudioReady());
    check('the master fades to nothing', master.gain.target === 0);
    check('nothing new can start', engine.voice({ dur: 0.1 }) === null);
    const before = engine.engineStats().voices;
    quiet(() => audio.playLowHealthWarning());
    check('not even the heartbeat', engine.engineStats().voices === before);

    await new Promise(resolve => setTimeout(resolve, 260));
    check('a sound still ringing when the menu opened is cut off', ringing.disconnected === true);

    press('Escape');
    check('resumed, the sound comes back', !audio.isMenuSilenced() && audio.isAudioReady() &&
        Math.abs(master.gain.target - audio.getMasterVolume()) < 1e-9);
    check('and sounds play again', engine.voice({ dur: 0.1 }) !== null);

    audio.setMuted(true);
    press('Escape');
    press('Escape');
    check('a player who muted stays muted after resuming', master.gain.target === 0 && audio.isMuted());
    audio.setMuted(false);
    check('and unmuting brings it back', master.gain.target > 0);

    quiet(() => gs.levelComplete());
    check('the level tally is silent', audio.isMenuSilenced() && master.gain.target === 0);
    quiet(() => gs.continueToNextLevel());
    check('Continue brings the sound back', !audio.isMenuSilenced() && master.gain.target > 0);

    play();
    quiet(() => { gs.player.health = 0; gs.beginPlayerDeath(); });
    check('the death cry belongs to the death, so it is heard', !audio.isMenuSilenced());
    quiet(() => gs.showGameOverScreen());
    check('Game Over is silent', audio.isMenuSilenced() && master.gain.target === 0);
}

// =============================================================================
// FULLSCREEN
// =============================================================================

console.log('[Fullscreen]');
{
    play();
    const label = () => doc.getElementById('pauseFullscreenButton').textContent;
    check('supported here, so the controls show', !doc.getElementById('cornerFullscreen').hidden &&
        !doc.getElementById('touchFullscreen').hidden && !doc.getElementById('pauseFullscreenButton').hidden);
    check('and the menu offers to go fullscreen', label() === 'Fullscreen');

    await quiet(() => doc.getElementById('cornerFullscreen').click());
    await Promise.resolve();
    check('the corner button asks for fullscreen on the whole page', doc.calls.request === 1 &&
        doc.fullscreenElement === doc.documentElement);
    check('play carries on', gs.gameRunning && !menu.paused);
    check('the page is marked fullscreen for the icons', doc.body.classList.contains('is-fullscreen'));

    const inFullscreen = press('Escape');
    check('an Esc that reaches the page while fullscreen is the browser\'s: no pause',
        !menu.paused && !inFullscreen.defaultPrevented);

    // The browser's Esc takes the page out of fullscreen...
    await quiet(() => doc.exitFullscreen());
    // ...and, in a browser that also hands the page the key, it comes after
    press('Escape');
    check('nor just after it left fullscreen', !menu.paused && gs.gameRunning);

    clock += FULLSCREEN_ESC_GRACE_MS + 1;
    press('Escape');
    check('a later Esc pauses as usual', menu.paused);

    await quiet(() => doc.getElementById('pauseFullscreenButton').click());
    await Promise.resolve();
    check('the menu\'s button goes fullscreen too, and stays paused', doc.calls.request === 2 && menu.paused);
    check('its label says which way it would go now', label() === 'Exit Fullscreen', label());

    await quiet(() => doc.getElementById('pauseFullscreenButton').click());
    await Promise.resolve();
    check('and pressed again leaves', doc.calls.exit === 2 && !fullscreen.isFullscreen(doc) &&
        label() === 'Fullscreen');

    press('Escape');
    check('Esc straight after leaving does not resume', menu.paused);
    clock += FULLSCREEN_ESC_GRACE_MS + 1;
    press('Escape');
    check('a later one does', !menu.paused && gs.gameRunning);

    await quiet(() => controller.touchControls.runAction('fullscreen'));
    await Promise.resolve();
    check('the touch row\'s button toggles it too', doc.calls.request === 3);
    await quiet(() => fullscreen.exitFullscreen(doc));
    clock += FULLSCREEN_ESC_GRACE_MS + 1;
}

console.log('[Fullscreen elsewhere]');
{
    const webkit = makeDocument({ webkit: true });
    check('the webkit spelling counts as support', fullscreen.fullscreenSupported(webkit));
    await quiet(() => fullscreen.toggleFullscreen(webkit));
    check('and is what gets called', webkit.calls.webkitRequest === 1 && fullscreen.isFullscreen(webkit));
    await quiet(() => fullscreen.toggleFullscreen(webkit));
    check('both ways', webkit.calls.webkitExit === 1 && !fullscreen.isFullscreen(webkit));

    const iphone = makeDocument({});
    check('a phone with no element fullscreen is unsupported', !fullscreen.fullscreenSupported(iphone));
    const phoneMenu = quiet(() => new PauseMenu(controller, { doc: iphone }));
    check('its fullscreen controls are all hidden',
        ['cornerFullscreen', 'touchFullscreen', 'pauseFullscreenButton'].every(id => iphone.getElementById(id).hidden));
    check('and the page is marked so', iphone.body.classList.contains('fullscreen-unsupported'));
    const asked = await quiet(() => phoneMenu.toggleFullscreen());
    check('asking anyway does nothing and does not throw', asked === false);

    const refused = makeDocument({ standard: true });
    refused.documentElement.requestFullscreen = async () => { throw new Error('denied'); };
    const ok = await quiet(() => fullscreen.enterFullscreen(refused));
    check('a refused request is swallowed, not thrown', ok === false && !fullscreen.isFullscreen(refused));
}

// =============================================================================
// THE SIMULATION CLOCK
// =============================================================================

console.log('\n[the simulation runs at 60 steps a second, whatever the display]');
{
    // Counts update() calls while frames arrive every `interval` ms (plus an
    // optional jitter), starting from a freshly started loop.
    const stepsOver = (count, interval, jitter = () => 0) => {
        play();
        let steps = 0;
        const update = gs.update;
        gs.update = function () { steps++; return update.call(this); };
        // God mode, so a long run cannot end in death and stop the count
        gs.player.godMode = true;
        try {
            quiet(() => {
                for (let i = 0; i < count; i++) {
                    clock += interval + jitter(i);
                    const batch = [...frames.values()];
                    frames.clear();
                    batch.forEach(fn => fn());
                }
            });
        } finally {
            gs.update = update;
        }
        return steps;
    };

    check('60 Hz: one step a frame', stepsOver(120, 1000 / 60) === 120);
    const jittered = stepsOver(120, 1000 / 60, i => (i % 2 ? 1.2 : -1.2));
    check('60 Hz with a millisecond of jitter: still one step a frame, no judder', jittered === 120, `${jittered}`);
    const fast = stepsOver(240, 1000 / 120);
    check('120 Hz: half a step a frame -- not twice the speed', Math.abs(fast - 120) <= 1, `${fast}`);
    const ninety = stepsOver(180, 1000 / 90);
    check('90 Hz: 60 steps a second', Math.abs(ninety - 120) <= 1, `${ninety}`);
    const slow = stepsOver(60, 1000 / 30);
    check('30 Hz: two steps a frame -- not slow motion', Math.abs(slow - 120) <= 1, `${slow}`);
    const stalled = stepsOver(1, 2000);
    check('a two-second stall catches up four steps, not 120', stalled === 4, `${stalled}`);

    play();
    quiet(() => gs.pause());
    clock += 60_000;
    let steps = 0;
    const update = gs.update;
    gs.update = function () { steps++; return update.call(this); };
    quiet(() => gs.resume());
    gs.update = update;
    check('a minute paused is not owed: resuming runs one step', steps === 1, `${steps}`);
}

console.log('');
if (failures > 0) {
    console.error(`${failures} pause check(s) failed.`);
    process.exit(1);
}
console.log('All pause checks passed.');
process.exit(0);
