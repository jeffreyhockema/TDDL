// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Audio system tests. Run with: npm test
 *
 * Sound is the one subsystem you cannot check by looking at the screen, and the
 * ways it breaks are mostly invisible until a player reports "no sound in
 * Firefox" or "the Cacodemon sounds like an Imp". So this suite drives every
 * sound through a fake AudioContext that is stricter than the real one, serves
 * the real sample files off disk, and asserts the things that actually go wrong:
 *
 *   1. Silence, not exceptions, when there is no Web Audio at all, and when the
 *      samples have not arrived yet. Every play function is called from
 *      gameplay code with no try/catch around it.
 *   2. The sound set is complete: every lump the game names is in
 *      sounds/sounds.pak and decodes, every monster names a voice, and every
 *      voice names real lumps. A typo in a lump name is a monster that dies
 *      silently, forever.
 *   3. Placement: Doom's panning and distance model, including the full-volume
 *      exception for the two bosses.
 *   4. Legal automation, sources always stopped, cooldowns and the voice budget
 *      holding under a firefight.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_FILES, loadPack, diskFetch } from './pack-files.mjs';
import { readEntry } from '../js/asset-pack.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- fake clock
//
// Cooldowns are measured against performance.now(). The suite runs without
// yielding, so real time barely advances and every cooldown would appear to be
// permanently active; driving the clock by hand is the only way to test them.

let clock = 0;

Object.defineProperty(globalThis, 'performance', {
    value: { now: () => clock },
    configurable: true,
    writable: true,
});

/**
 * Advances the fake clock.
 * @param {number} ms
 */
function advance(ms) {
    clock += ms;
}

// ---------------------------------------------------------------- fake Web Audio

const created = [];      // Every node the engine made
const started = [];      // Every source that was start()ed
const automation = [];   // Every param write, for the legality checks

/**
 * A parameter that refuses the values the real API refuses, so a bad envelope
 * fails here instead of in someone's browser.
 */
class FakeParam {
    constructor(name, value) {
        this.name = name;
        this.value = value;
    }

    check(method, value, time) {
        automation.push({ param: this.name, method, value, time });
        assert.ok(Number.isFinite(value), `${this.name}.${method} got non-finite value ${value}`);
        assert.ok(Number.isFinite(time), `${this.name}.${method} got non-finite time ${time}`);
        assert.ok(time >= 0, `${this.name}.${method} scheduled at negative time ${time}`);
        if (method === 'exponentialRampToValueAtTime') {
            assert.ok(value > 0, `${this.name}: exponential ramp to ${value} throws in browsers`);
        }
        this.value = value;
    }

    setValueAtTime(v, t) { this.check('setValueAtTime', v, t); return this; }
    linearRampToValueAtTime(v, t) { this.check('linearRampToValueAtTime', v, t); return this; }
    exponentialRampToValueAtTime(v, t) { this.check('exponentialRampToValueAtTime', v, t); return this; }
    setTargetAtTime(v, t, c) {
        this.check('setTargetAtTime', v, t);
        assert.ok(Number.isFinite(c), 'setTargetAtTime got non-finite time constant');
        return this;
    }
    cancelScheduledValues(t) {
        assert.ok(Number.isFinite(t), 'cancelScheduledValues got non-finite time');
        return this;
    }
}

class FakeNode {
    constructor(type, context) {
        this.type_ = type;
        this.context = context;
        this.connections = [];
        created.push(this);
    }

    // The real API returns the destination, which is what makes a.connect(b).connect(c) work.
    connect(target) {
        assert.ok(target, `${this.type_}.connect() called with nothing`);
        this.connections.push(target);
        return target;
    }

    disconnect() {}
}

class FakeSource extends FakeNode {
    constructor(type, context) {
        super(type, context);
        this.startTime = null;
        this.stopTime = null;
    }

    start(when = 0, offset = 0) {
        assert.equal(this.startTime, null, `${this.type_} started twice`);
        // Sample buffers carry the lump they were decoded from, so a test can ask
        // which sound played rather than merely whether one did.
        this.lump = this.buffer ? this.buffer.lump || null : null;
        assert.ok(Number.isFinite(when) && when >= 0, `${this.type_}.start(${when})`);
        assert.ok(Number.isFinite(offset) && offset >= 0, `${this.type_}.start offset ${offset}`);
        if (this.buffer) {
            assert.ok(offset < this.buffer.duration,
                `${this.type_} starts past the end of its buffer (${offset} of ${this.buffer.duration}s)`);
        }
        this.startTime = when;
        started.push(this);
    }

    stop(when = 0) {
        assert.ok(Number.isFinite(when) && when >= 0, `${this.type_}.stop(${when})`);
        if (this.startTime !== null) {
            assert.ok(when >= this.startTime, `${this.type_} stops before it starts`);
        }
        this.stopTime = when;
    }
}

/**
 * Reads the length of a PCM WAV by walking its chunks, so a decoded "buffer"
 * has the real duration of the file on disk.
 *
 * @param {ArrayBuffer} bytes
 * @returns {{sampleRate: number, duration: number}}
 */
function wavInfo(bytes) {
    const view = new DataView(bytes);
    const tag = (at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    assert.equal(tag(0), 'RIFF', 'not a RIFF file');
    assert.equal(tag(8), 'WAVE', 'not a WAVE file');

    let at = 12;
    let byteRate = 0;
    let sampleRate = 0;
    while (at + 8 <= view.byteLength) {
        const id = tag(at);
        const size = view.getUint32(at + 4, true);
        if (id === 'fmt ') {
            sampleRate = view.getUint32(at + 12, true);
            byteRate = view.getUint32(at + 16, true);
        } else if (id === 'data') {
            assert.ok(byteRate > 0, 'data chunk before fmt chunk');
            return { sampleRate, duration: size / byteRate };
        }
        at += 8 + size + (size % 2);
    }
    assert.fail('no data chunk');
}

class FakeAudioContext {
    constructor() {
        this.state = 'suspended';
        this.sampleRate = 44100;
        this.currentTime = 0;
        this.destination = new FakeNode('destination', this);
    }

    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }

    /** Decodes by header only: we need the length, not the audio. */
    decodeAudioData(bytes, resolve, reject) {
        try {
            const info = wavInfo(bytes);
            const buffer = this.createBuffer(1, Math.max(1, Math.floor(info.duration * info.sampleRate)), info.sampleRate);
            buffer.lump = lumpOf(bytes);
            resolve(buffer);
        } catch (error) {
            reject(error);
        }
    }

    createGain() {
        const node = new FakeNode('gain', this);
        node.gain = new FakeParam('gain', 1);
        return node;
    }

    createBiquadFilter() {
        const node = new FakeNode('biquad', this);
        node.frequency = new FakeParam('frequency', 350);
        node.Q = new FakeParam('Q', 1);
        node.gain = new FakeParam('gain', 0);
        node.detune = new FakeParam('detune', 0);
        return node;
    }

    createOscillator() {
        const node = new FakeSource('oscillator', this);
        node.frequency = new FakeParam('frequency', 440);
        node.detune = new FakeParam('detune', 0);
        return node;
    }

    createBufferSource() {
        const node = new FakeSource('bufferSource', this);
        node.playbackRate = new FakeParam('playbackRate', 1);
        node.buffer = null;
        node.loop = false;
        return node;
    }

    createStereoPanner() {
        const node = new FakeNode('panner', this);
        node.pan = new FakeParam('pan', 0);
        return node;
    }

    createWaveShaper() {
        const node = new FakeNode('waveShaper', this);
        node.curve = null;
        node.oversample = 'none';
        return node;
    }

    createConvolver() {
        const node = new FakeNode('convolver', this);
        node.buffer = null;
        return node;
    }

    createDynamicsCompressor() {
        const node = new FakeNode('compressor', this);
        for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) {
            node[name] = new FakeParam(name, 0);
        }
        return node;
    }

    createBuffer(channels, length, sampleRate) {
        assert.ok(length > 0, 'createBuffer with empty length');
        const data = [];
        for (let i = 0; i < channels; i++) data.push(new Float32Array(length));
        return {
            length,
            sampleRate,
            duration: length / sampleRate,
            numberOfChannels: channels,
            getChannelData: (i) => data[i],
        };
    }
}

// Serve the sound pack off disk, so the suite exercises the real sound set
// rather than a fixture that can drift from it.
globalThis.fetch = diskFetch();

// Sample buffers carry the lump they were decoded from, so a test can ask which
// sound played. The engine hands decodeAudioData() bare bytes cut from the
// pack, so the lump is recognised by its contents.
const soundPack = loadPack(PACK_FILES.sounds);
const lumpsByDigest = new Map();
const digest = (bytes) => createHash('sha1').update(new Uint8Array(bytes)).digest('hex');
for (const name of soundPack ? soundPack.entries.keys() : []) {
    lumpsByDigest.set(digest(readEntry(soundPack, name)), name.replace(/\.wav$/, ''));
}

/** @param {ArrayBuffer} bytes @returns {string|null} The lump these bytes are */
function lumpOf(bytes) {
    return lumpsByDigest.get(digest(bytes)) || null;
}

// ---------------------------------------------------------------- harness

const failures = [];

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ok   ${name}`);
    } catch (error) {
        failures.push(name);
        console.error(`  FAIL ${name}: ${error.message}`);
    }
}

/** Clears the recording arrays between tests. */
function reset() {
    created.length = 0;
    started.length = 0;
    automation.length = 0;
}

/**
 * Tears the engine down and brings it back up, keeping the decoded samples.
 *
 * Voices are only released by a timer, and no timer fires during the run, so
 * the voice budget fills as the suite proceeds and later tests would measure
 * exhaustion rather than the behaviour they name.
 */
async function freshEngine() {
    audio.cleanupAudio();
    await audio.ensureAudioAndSynths();
    reset();
}

/**
 * How many voices a piece of code adds to the mix -- the one measure of "did
 * that actually play" that does not depend on timing.
 *
 * @param {Function} fn
 * @returns {number}
 */
function voiceDelta(fn) {
    const before = audio.engineStats().voices;
    fn();
    return audio.engineStats().voices - before;
}

/** The samples the last piece of code started, by lump name. */
function playedLumps(fn) {
    const before = started.length;
    fn();
    return started.slice(before).filter(s => s.buffer && s.lump).map(s => s.lump);
}

const originalLog = console.log;
const originalWarn = console.warn;
const quiet = async (fn) => {
    console.log = () => {};
    console.warn = () => {};
    try { return await fn(); } finally { console.log = originalLog; console.warn = originalWarn; }
};

console.log('\nAudio system tests\n');

// ---------------------------------------------------------------- 1. no Web Audio

// Loaded before any AudioContext exists, exactly as it would be in a browser too
// old to have one -- and as it is in the other headless suites.
const audio = await import('../js/audio-system.js');
const engine = await import('../js/audio-engine.js');
const { MONSTERS, MONSTER_TYPES } = await import('../js/monsters.js');

const PLAY_FUNCTIONS = [
    'playMeleeHitSound', 'playEmptyGunSound', 'playWeaponSwitchSound',
    'playPlayerHitSound', 'playRocketExplosionSound', 'playBarrelExplosionSound',
    'playBFGImpactSound', 'playResurrectSound',
    'playEnemyGunSound', 'playEnemyShootSound', 'playEnemyMeleeSound',
    'playEnemyWindupSound', 'playEnemySightSound', 'playEnemyPainSound',
    'playEnemyActiveSound', 'playEnemyStepSound', 'playEnemyDestroySound',
    'playHealthPickupSound', 'playAmmoPickupSound', 'playKeyPickupSound',
    'playWeaponPickupSound', 'playPowerupSound', 'playDoorOpenSound', 'playDoorCloseSound',
    'playSwitchSound', 'playSecretDoorOpenSound', 'playTeleportSound',
    'playErrorSound', 'playUIClickSound', 'playUIHoverSound',
    'playLowHealthWarning', 'playLevelCompleteSound', 'playGameOverSound',
    'playPlayerDeathSound', 'playAmbientSound',
];

const WEAPONS = ['Knife', 'Pistol', 'Shotgun', 'Rifle', 'Rocket Launcher', 'Plasma Gun', 'BFG'];

await test('every documented entry point is exported', () => {
    for (const name of PLAY_FUNCTIONS.concat([
        'playShootSound', 'initializeAudio', 'ensureAudioAndSynths', 'preloadSounds', 'preloadSoundTasks',
        'cleanupAudio', 'getAudioState', 'isAudioReady', 'soundStats', 'spatialise',
        'startMenuMusic', 'stopMenuMusic', 'startAmbientBed', 'stopAmbientBed',
        'setMasterVolume', 'getMasterVolume', 'setMuted', 'isMuted', 'engineStats',
        'setMenuSilence', 'isMenuSilenced',
    ])) {
        assert.equal(typeof audio[name], 'function', `${name} is not exported as a function`);
    }
    assert.ok(Array.isArray(audio.SAMPLE_NAMES) && audio.SAMPLE_NAMES.length > 50, 'SAMPLE_NAMES');
    assert.ok(audio.MONSTER_VOICES && typeof audio.MONSTER_VOICES === 'object', 'MONSTER_VOICES');
});

await test('runs silently with no Web Audio at all', () => {
    assert.equal(audio.getAudioState(), 'unavailable');
    assert.equal(audio.isAudioReady(), false);
    for (const name of PLAY_FUNCTIONS) audio[name]();
    for (const weapon of WEAPONS) audio.playShootSound(weapon);
    audio.startMenuMusic();
    audio.stopMenuMusic();
    audio.startAmbientBed();
    audio.stopAmbientBed();
    // Nothing for the loading screen to wait on, rather than a hundred loads
    // that could never be played.
    assert.deepEqual(audio.preloadSoundTasks(), []);
});

// ---------------------------------------------------------------- 2. the sound set

await test('every monster names a voice, and every voice names real lumps', () => {
    const bad = [];
    for (const type of MONSTER_TYPES) {
        const voice = MONSTERS[type].sounds;
        if (!audio.MONSTER_VOICES[voice]) bad.push(`${type} -> "${voice}"`);
    }
    assert.equal(bad.length, 0, `monsters with no voice: ${bad.join(', ')}`);

    const known = new Set(audio.SAMPLE_NAMES);
    const missing = [];
    for (const [name, voice] of Object.entries(audio.MONSTER_VOICES)) {
        for (const [role, lumps] of Object.entries(voice)) {
            if (role === 'full' || role === 'stepEvery') continue;
            for (const lump of [].concat(lumps)) {
                if (!known.has(lump)) missing.push(`${name}.${role}: ${lump}`);
            }
        }
        if (voice.step) assert.ok(voice.stepEvery > 0, `${name} has steps but no stepEvery`);
    }
    assert.equal(missing.length, 0, `voice lumps not in SAMPLE_NAMES: ${missing.join(', ')}`);
});

await test('every lump is in the sound pack, with its provenance beside it', () => {
    assert.ok(soundPack, `${PACK_FILES.sounds} is missing`);
    const packed = [...soundPack.entries.keys()];
    const missing = audio.SAMPLE_NAMES.filter(name => !soundPack.entries.has(`${name}.wav`));
    assert.equal(missing.length, 0, `missing from the pack: ${missing.join(', ')}`);
    assert.ok(fs.existsSync(path.join(root, 'sounds', 'README.md')), 'sounds/README.md');

    const unused = packed
        .filter(f => !f.endsWith('.wav') || !audio.SAMPLE_NAMES.includes(f.replace(/\.wav$/, '')));
    assert.equal(unused.length, 0, `sounds in the pack nothing plays: ${unused.join(', ')}`);
    assert.ok(packed.every(f => soundPack.entries.get(f).type === 'audio/wav'), 'a sound is not typed audio/wav');
});

// ---------------------------------------------------------------- 3. with a context

globalThis.AudioContext = FakeAudioContext;

await test('sounds are silent, not broken, before the samples arrive', async () => {
    // Start audio without waiting for the load.
    await audio.ensureAudioAndSynths();
    assert.equal(audio.isAudioReady(), true);
    // The load is in flight but nothing has resolved yet: every sample-backed
    // sound must simply not play.
    reset();
    audio.playShootSound('Pistol');
    audio.playEnemySightSound('imp', { x: 0, y: 0 });
    assert.equal(started.filter(s => s.lump).length, 0, 'a sample played before it was decoded');
});

await test('the whole sound set loads and decodes', async () => {
    const count = await quiet(() => audio.preloadSounds());
    const stats = audio.soundStats();
    assert.equal(count, audio.SAMPLE_NAMES.length, `${count} of ${audio.SAMPLE_NAMES.length} loaded`);
    assert.equal(stats.loaded, stats.total);
});

await test('a sample asked for twice while loading is read once', async () => {
    // The loading screen asks for every sample individually, to drive its
    // progress bar, while initializeAudio() has usually already asked for the
    // whole set. The second request must wait on the first, not decode again.
    // A name outside the set, so this load is genuinely still in flight.
    let reads = 0;
    const source = async () => { reads++; return readEntry(soundPack, 'dspistol.wav').buffer; };
    const first = engine.loadSample('loading-probe', source);
    const second = engine.loadSample('loading-probe', source);
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(reads, 1, `read ${reads} times`);

    // Once decoded, asking again costs nothing.
    assert.equal(await engine.loadSample('loading-probe', source), true);
    assert.equal(reads, 1);
});

await test('a sample whose bytes are unavailable stays silent, without a fuss', async () => {
    // What the sound pack's sources do when the pack never arrived: the pack
    // loader has already logged it, once.
    let warned = 0;
    const warn = console.warn;
    console.warn = () => { warned++; };
    try {
        assert.equal(await engine.loadSample('absent-probe', async () => null), false);
    } finally {
        console.warn = warn;
    }
    assert.equal(engine.hasSample('absent-probe'), false);
    assert.equal(warned, 0, 'warned once per sample about a pack that already said it was missing');
});

await test("the loading screen gets one task per sample, sharing the set's loads", async () => {
    const serve = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (url) => { fetches++; return serve(url); };
    try {
        const tasks = audio.preloadSoundTasks();
        assert.deepEqual(tasks.map(t => t.name), audio.SAMPLE_NAMES);
        const results = await quiet(() => Promise.all(tasks.map(t => t.ready)));
        assert.ok(results.every(Boolean), 'a sample task reported failure');
        assert.equal(fetches, 0, `${fetches} samples were fetched a second time`);
    } finally {
        globalThis.fetch = serve;
    }
});

await test('every weapon fires its Doom sample', async () => {
    await freshEngine();
    const expected = {
        Pistol: ['dspistol'],
        Rifle: ['dschngun'],
        Shotgun: ['dsshotgn', 'dssgcock'],
        'Rocket Launcher': ['dsrlaunc'],
        'Plasma Gun': ['dsplasma'],
        BFG: ['dsbfg'],
        Knife: ['dsskeswg'],
    };
    for (const weapon of WEAPONS) {
        const lumps = playedLumps(() => audio.playShootSound(weapon));
        assert.deepEqual(lumps, expected[weapon], `${weapon} played ${lumps.join(', ') || 'nothing'}`);
    }

    // The pump comes after the shot, not with it.
    reset();
    audio.playShootSound('Shotgun');
    const [shot, pump] = started;
    assert.ok(pump.startTime > shot.startTime + 0.4, 'shotgun pump is not delayed');
});

await test('every monster voice plays the right lump for each role', async () => {
    await freshEngine();
    const at = { x: 100, y: 100 };
    for (const [name, voice] of Object.entries(audio.MONSTER_VOICES)) {
        // Over a hundred voices are opened here and none are freed without a
        // timer; a fresh budget per monster keeps this about lumps, not limits.
        await freshEngine();
        const roles = [
            ['sight', () => audio.playEnemySightSound(name, at)],
            ['pain', () => audio.playEnemyPainSound(name, at)],
            ['active', () => audio.playEnemyActiveSound(name, at)],
            ['death', () => audio.playEnemyDestroySound(name, at)],
            ['attack', () => audio.playEnemyShootSound(name, at)],
            ['melee', () => audio.playEnemyMeleeSound(name, at)],
            ['windup', () => audio.playEnemyWindupSound(name, at)],
        ];
        for (const [role, play] of roles) {
            advance(1000);
            const lumps = playedLumps(play);
            const wanted = voice[role];
            if (!wanted && role !== 'attack') {
                assert.equal(lumps.length, 0, `${name} has no ${role} but played ${lumps}`);
                continue;
            }
            assert.equal(lumps.length, 1, `${name}.${role} played ${lumps.length} sounds`);
            if (wanted) {
                assert.ok([].concat(wanted).includes(lumps[0]), `${name}.${role} played ${lumps[0]}, wanted ${wanted}`);
            } else {
                assert.equal(lumps[0], 'dsfirsht', `${name} with no attack sound should fall back to the fireball`);
            }
        }
    }
});

await test('the heavy monsters are heard walking, the others are not', async () => {
    await freshEngine();
    const at = { x: 100, y: 100 };
    const walk = (voice, frames) => {
        const lumps = [];
        for (let f = 1; f <= frames; f++) {
            advance(50);
            lumps.push(...playedLumps(() => audio.playEnemyStepSound(voice, at, f)));
        }
        return lumps;
    };
    assert.deepEqual(walk('imp', 40), [], 'an Imp has footsteps');
    assert.deepEqual(walk('cyberdemon', 40), ['dsmetal', 'dshoof', 'dsmetal', 'dshoof'],
        'the Cyberdemon does not alternate hoof and metal');
    assert.deepEqual(walk('arachnotron', 40), ['dsbspwlk', 'dsbspwlk']);
});

await test('sounds are placed the way Doom places them', async () => {
    await freshEngine();
    globalThis.window = globalThis;
    globalThis.gameState = { player: { x: 1000, y: 1000 } };

    const right = audio.spatialise({ x: 1200, y: 1000 });
    const left = audio.spatialise({ x: 800, y: 1000 });
    assert.ok(right.pan > 0.3 && left.pan < -0.3, `pan: right ${right.pan}, left ${left.pan}`);
    assert.ok(right.pan < 1 && left.pan > -1, 'Doom never pans fully to one side');
    assert.equal(audio.spatialise({ x: 1050, y: 1000 }).gain, 1, 'close sounds are full volume');

    const far = audio.spatialise({ x: 1000 + 40 * 12, y: 1000 });
    assert.ok(far.gain > 0 && far.gain < 0.7, `12 tiles away should be quieter, got ${far.gain}`);
    assert.equal(audio.spatialise({ x: 1000 + 40 * 25, y: 1000 }), null, '25 tiles away is out of earshot');
    assert.deepEqual(audio.spatialise(undefined), { gain: 1, pan: 0 }, 'unplaced sounds are centred');

    // Out of earshot means not played at all, not played quietly.
    advance(1000);
    assert.equal(voiceDelta(() => audio.playEnemySightSound('imp', { x: 1000 + 40 * 25, y: 1000 })), 0,
        'an Imp 25 tiles away was heard');
    advance(1000);
    assert.equal(voiceDelta(() => audio.playEnemySightSound('imp', { x: 1100, y: 1000 })), 1);

    // The bosses' sight and death cries carry across the whole map.
    advance(1000);
    assert.equal(voiceDelta(() => audio.playEnemySightSound('cyberdemon', { x: 9000, y: 9000 })), 1,
        'the Cyberdemon was not heard from across the map');
    advance(1000);
    assert.equal(voiceDelta(() => audio.playEnemyDestroySound('spider_mastermind', { x: 9000, y: 9000 })), 1);
    advance(1000);
    assert.equal(voiceDelta(() => audio.playEnemyPainSound('cyberdemon', { x: 9000, y: 9000 })), 0,
        'boss pain is positional, and should have been out of earshot');

    delete globalThis.gameState;
});

await test('items, doors and switches use the Doom lumps', async () => {
    await freshEngine();
    const expect = (fn, lump) => {
        advance(1000);
        const lumps = playedLumps(fn);
        assert.deepEqual(lumps, [].concat(lump), `played ${lumps.join(', ') || 'nothing'}, wanted ${lump}`);
    };
    expect(() => audio.playHealthPickupSound(), 'dsitemup');
    expect(() => audio.playAmmoPickupSound(), 'dsitemup');
    expect(() => audio.playKeyPickupSound(), 'dsitemup');
    expect(() => audio.playWeaponPickupSound(), 'dswpnup');
    expect(() => audio.playPowerupSound(), 'dsgetpow');
    expect(() => audio.playDoorOpenSound(), 'dsdoropn');
    expect(() => audio.playDoorCloseSound(), 'dsdorcls');
    expect(() => audio.playSwitchSound(), 'dsswtchn');
    expect(() => audio.playSecretDoorOpenSound(), ['dsstnmov', 'dsstnmov', 'dsstnmov', 'dsstnmov']);
    expect(() => audio.playTeleportSound(), 'dstelept');
    expect(() => audio.playErrorSound(), 'dsnoway');
    expect(() => audio.playPlayerHitSound(), 'dsplpain');
    expect(() => audio.playGameOverSound(), 'dspldeth');
    expect(() => audio.playPlayerDeathSound(), 'dspldeth');
    expect(() => audio.playRocketExplosionSound(), 'dsbarexp');
    expect(() => audio.playBFGImpactSound(), 'dsrxplod');
    expect(() => audio.playMeleeHitSound(), 'dspunch');
    expect(() => audio.playEnemyGunSound('shotgun'), 'dsshotgn');
    expect(() => audio.playEnemyGunSound('rifle'), 'dspistol');
    expect(() => audio.playEnemyGunSound('chaingun'), 'dschngun');
    expect(() => audio.playEnemyGunSound('ss'), 'dsssgun');
    expect(() => audio.playResurrectSound(), 'dsvilrai');
    advance(1000);
    const barrel = playedLumps(() => audio.playBarrelExplosionSound());
    assert.ok(barrel.length === 1 && ['dsbarexp', 'dsexplo1', 'dsexplo2'].includes(barrel[0]),
        `barrel played ${barrel}`);
    expect(() => audio.playUIClickSound(), 'dsswtchn');
    expect(() => audio.playUIHoverSound(), 'dspstop');
});

await test('mechanical sounds never drift in pitch; weapons and monsters do', async () => {
    await freshEngine();
    const rates = (fn, n) => {
        const out = [];
        for (let i = 0; i < n; i++) {
            advance(1000);
            const before = started.length;
            fn();
            out.push(...started.slice(before).map(s => s.playbackRate.value));
        }
        return out;
    };
    assert.ok(rates(() => audio.playDoorOpenSound(), 6).every(r => r === 1), 'a door changed pitch');
    assert.ok(rates(() => audio.playSwitchSound(), 6).every(r => r === 1), 'a switch changed pitch');
    const pistol = rates(() => audio.playShootSound('Pistol'), 12);
    assert.ok(new Set(pistol).size > 1, 'twelve pistol shots at exactly the same pitch');
    assert.ok(pistol.every(r => r > 0.9 && r < 1.1), 'pistol drift is too wide');
});

await test('every sound effect plays without throwing', async () => {
    await freshEngine();
    for (const name of PLAY_FUNCTIONS) {
        advance(3000);
        try {
            audio[name]();
        } catch (error) {
            assert.fail(`${name} threw: ${error.message}`);
        }
    }
});

await test('sources that start are always given a stop time', async () => {
    await freshEngine();
    audio.playRocketExplosionSound();
    audio.playEnemyDestroySound('cyberdemon');
    audio.playShootSound('BFG');
    audio.playLowHealthWarning();
    audio.startMenuMusic();
    assert.ok(started.length > 4);
    for (const source of started) {
        assert.notEqual(source.stopTime, null,
            `${source.type_} started at ${source.startTime} and was never stopped`);
    }
    audio.stopMenuMusic();
});

await test('cooldowns rate-limit the spammy events', async () => {
    await freshEngine();
    advance(5000);

    // Walking through a row of shells in one frame is one pickup blip.
    const burst = voiceDelta(() => {
        for (let i = 0; i < 50; i++) audio.playAmmoPickupSound();
    });
    assert.equal(burst, 1, `a single frame of pickups opened ${burst} voices`);

    // ...but the cooldown lapses, rather than silencing the sound for good.
    advance(200);
    assert.equal(voiceDelta(() => audio.playAmmoPickupSound()), 1, 'pickup never came back after its cooldown');

    // A pack of zombies seeing you at once is not fifteen grunts in one frame.
    advance(5000);
    const grunts = voiceDelta(() => {
        for (let i = 0; i < 15; i++) audio.playEnemySightSound('zombie', { x: 0, y: 0 });
    });
    assert.equal(grunts, 1, `fifteen simultaneous sightings opened ${grunts} voices`);
});

await test('a firefight stays inside the voice budget', async () => {
    await freshEngine();
    const stats = audio.engineStats();
    const added = voiceDelta(() => {
        for (let i = 0; i < 400; i++) {
            advance(60);
            audio.playEnemyGunSound('rifle');
            audio.playEnemyShootSound('imp');
            audio.playShootSound('Rifle');
        }
    });
    assert.ok(added <= stats.maxVoices, `a burst added ${added} voices, budget is ${stats.maxVoices}`);

    // Priority sounds skip the budget so an explosion is never the sound that
    // gets dropped -- but they still stop at the hard ceiling.
    await freshEngine();
    const priority = voiceDelta(() => {
        for (let i = 0; i < 200; i++) audio.playRocketExplosionSound();
    });
    assert.ok(priority <= stats.voiceCeiling, `priority sounds added ${priority} voices, ceiling is ${stats.voiceCeiling}`);
});

await test('volume and mute are honoured', () => {
    audio.setMasterVolume(0.5);
    assert.equal(audio.getMasterVolume(), 0.5);
    audio.setMasterVolume(9);
    assert.equal(audio.getMasterVolume(), 1, 'volume was not clamped');
    assert.equal(audio.setMuted(true), true);
    assert.equal(audio.isMuted(), true);
    audio.setMuted(false);
    audio.setMasterVolume(0.9);
});

await test('cleanup keeps the samples, closes the context, and leaves the API silent', async () => {
    const before = audio.soundStats().loaded;
    audio.cleanupAudio();
    assert.equal(audio.isAudioReady(), false);
    assert.equal(audio.soundStats().loaded, before, 'cleanup threw the decoded samples away');
    for (const name of PLAY_FUNCTIONS) audio[name]();

    // And a restart plays again without refetching.
    globalThis.fetch = async () => { throw new Error('no refetch allowed'); };
    await audio.ensureAudioAndSynths();
    reset();
    advance(5000);
    assert.equal(voiceDelta(() => audio.playShootSound('Pistol')), 1, 'no sound after a restart');
});

// ---------------------------------------------------------------- results

console.log('');
if (failures.length === 0) {
    console.log('Audio: all checks passed.');
    process.exit(0);
} else {
    console.error(`Audio: ${failures.length} check(s) FAILED: ${failures.join(', ')}`);
    process.exit(1);
}
