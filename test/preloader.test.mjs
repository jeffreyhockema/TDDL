// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Loading screen checks. Run with: npm test
 *
 * On a phone the first level used to appear before its artwork had arrived,
 * so the marine was drawn as the fallback dot for a moment: the character
 * atlases were only requested on their first draw, and nothing waited for any
 * of it. These check the pieces that fix that:
 *
 *   1. whenImageReady() -- an image counts as ready only once it is drawable,
 *      a broken one resolves false instead of hanging, and decode() is used
 *      where it exists without being trusted blindly.
 *
 *   2. LoadTracker -- counts, failures counted as done, work discovered by a
 *      task (a manifest's atlases) waited for too, and the stall and overall
 *      deadlines that keep a lost request from wedging the loading screen.
 *      Downloads are counted by their bytes, the bar never runs backwards as
 *      their sizes become known, and bytes arriving hold off the stall timer.
 *
 *   3. The loaders' preload hooks -- every player atlas, the roster's enemy
 *      atlases (all of them if the roster names one the manifest lacks), and
 *      every item icon, sharing the images the renderer draws, all decoded
 *      out of the asset packs.
 *
 *   4. The gate itself -- GameController will not start a level while assets
 *      are loading, shows the start menu only afterwards, and still gets there
 *      when an atlas is damaged or a whole pack is missing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diskFetch } from './pack-files.mjs';
import { parsePack } from '../js/asset-pack.js';

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

/** Resolves after the given number of milliseconds. */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A promise plus the function that resolves it, for holding loads open. */
function gate() {
    let open;
    const promise = new Promise((resolve) => { open = resolve; });
    return { promise, open };
}

// ---------------------------------------------------------------- Image stub
//
// Behaves like the real element where it matters: not complete until its src
// has loaded, `complete` but zero-sized once it has failed, load/error events,
// and -- when FakeImage.withDecode is set -- a decode() that settles with them.

/** Image sources (by basename) that should fail to load. */
const brokenImages = new Set();

/** Image loads wait on this, so a test can hold them in flight. */
let imageGate = Promise.resolve();

class FakeImage {
    static withDecode = false;

    constructor() {
        this.complete = false;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
        this.listeners = { load: [], error: [] };
        this._src = '';
        if (FakeImage.withDecode) {
            this.decode = () => new Promise((resolve, reject) => {
                this.addEventListener('load', () => resolve());
                this.addEventListener('error', () => reject(new Error('EncodingError')));
            });
        }
    }

    get src() { return this._src; }

    set src(value) {
        this._src = value;
        const broken = brokenImages.has(path.basename(String(value)));
        imageGate.then(() => setTimeout(() => {
            this.complete = true;
            if (broken) {
                this.listeners.error.forEach((fn) => fn());
            } else {
                this.naturalWidth = 64;
                this.naturalHeight = 64;
                this.listeners.load.forEach((fn) => fn());
            }
        }, 0));
    }

    addEventListener(type, fn) {
        if (this.listeners[type]) this.listeners[type].push(fn);
    }
}

globalThis.Image = FakeImage;

// ---------------------------------------------------------------- DOM stubs

const elements = new Map();

function makeElement(id) {
    const ctx = new Proxy({}, {
        get: (target, key) => (key in target ? target[key] : noop),
        set: (target, key, value) => { target[key] = value; return true; },
    });
    ctx.measureText = () => ({ width: 10 });
    ctx.createLinearGradient = () => ({ addColorStop: noop });
    ctx.createRadialGradient = () => ({ addColorStop: noop });
    return {
        id, style: {}, dataset: {}, textContent: '', innerHTML: '',
        width: 1200, height: 800,
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        addEventListener: noop, removeEventListener: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
        getContext: () => ctx,
        querySelector: () => makeElement('child'),
        querySelectorAll: () => [],
    };
}

function element(id) {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
}

globalThis.window = globalThis;
globalThis.document = {
    getElementById: element,
    querySelector: () => makeElement('q'),
    querySelectorAll: () => [],
    createElement: () => makeElement('offscreen'),
    addEventListener: noop,
    removeEventListener: noop,
    hidden: false,
    body: { dataset: {} },
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.AbortController = class { constructor() { this.signal = {}; } abort() {} };

/** Manifest and pack fetches wait on this, so a test can hold the loading screen up. */
let fetchGate = Promise.resolve();

/** Pack entries (by name) to damage as they are served, and packs (by URL) to withhold. */
const damagedEntries = new Set();
const missingFiles = new Set();

// Serve the manifests and packs off disk so the suite exercises what the build
// produced -- with a byte flipped in any entry a test wants broken.
globalThis.fetch = diskFetch({
    before: () => fetchGate,
    rewrite: (url, bytes) => {
        if (missingFiles.has(url)) return null;
        if (!url.endsWith('.pak') || damagedEntries.size === 0) return bytes;
        for (const entry of parsePack(bytes).entries.values()) {
            if (damagedEntries.has(entry.name)) bytes[entry.offset + (entry.length >> 1)] ^= 0xff;
        }
        return bytes;
    },
});

const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
const quiet = () => { console.log = noop; console.warn = noop; };
const loud = () => { console.log = origLog; console.warn = origWarn; console.error = origError; };

quiet();
const { whenImageReady, LoadTracker } = await import('../js/asset-preloader.js');
const playerSprites = await import('../js/player-sprites.js');
const enemySprites = await import('../js/enemy-sprites.js');
const icons = await import('../js/item-icons.js');
const { MONSTERS } = await import('../js/monsters.js');
const { GameController } = await import('../js/main.js');
loud();

console.log('\n=== loading screen ===\n');

/** An image with its src set, the way the loaders hand them over. */
function loadingImage(file) {
    const image = new FakeImage();
    image.src = file;
    return image;
}

// ---------------------------------------------------------------- 1. whenImageReady

check('no image is not ready', (await whenImageReady(null)) === false);

for (const withDecode of [false, true]) {
    FakeImage.withDecode = withDecode;
    const how = withDecode ? 'with decode()' : 'from load events';

    check(`an image that loads is ready (${how})`,
        (await whenImageReady(loadingImage('fine.png'))) === true);

    brokenImages.add('broken.png');
    check(`an image that fails resolves false rather than hanging (${how})`,
        (await whenImageReady(loadingImage('broken.png'))) === false);
}
FakeImage.withDecode = false;

{
    // Already finished before anyone asked: `complete` alone does not say
    // which way it went, the size does.
    const loaded = loadingImage('fine.png');
    const failed = loadingImage('broken.png');
    await wait(5);
    check('an image that already loaded is ready at once', (await whenImageReady(loaded)) === true);
    check('an image that already failed is not', (await whenImageReady(failed)) === false);
}

{
    // Safari can reject decode() for an image that loaded perfectly well.
    const image = loadingImage('fine.png');
    await wait(5);
    image.decode = () => Promise.reject(new Error('EncodingError'));
    check('a spurious decode() rejection does not fail a loaded image',
        (await whenImageReady(image)) === true);
}

// ---------------------------------------------------------------- 2. LoadTracker

{
    const seen = [];
    const tracker = new LoadTracker({ onProgress: (p) => seen.push({ ...p }) });
    tracker.track('a', Promise.resolve(true));
    tracker.track('b', Promise.resolve(false));
    tracker.track('c', Promise.reject(new Error('boom')));
    quiet();
    const result = await tracker.finished();
    loud();

    check('every load is counted', result.total === 3 && tracker.done === 3, JSON.stringify(result));
    check('failures and rejections count as done, and as failed',
        result.failed === 2 && result.loaded === 1 && !result.timedOut, JSON.stringify(result));
    check('progress is reported as loads settle', seen.at(-1)?.done === 3 && seen.at(-1)?.total === 3);
    check('progress never runs backwards',
        seen.every((p, i) => i === 0 || p.done >= seen[i - 1].done));
    check('the failures are named', tracker.failures.join() === 'b,c', tracker.failures.join());
}

{
    // A manifest's task tracks its atlases before it settles; finished() must
    // wait for them rather than firing when the manifest alone is done.
    const tracker = new LoadTracker();
    const atlas = gate();
    let atlasDone = false;
    tracker.track('manifest', wait(5).then(() => {
        tracker.track('atlas', atlas.promise.then(() => { atlasDone = true; return true; }));
        return true;
    }));
    const finished = tracker.finished();
    let early = false;
    finished.then(() => { early = !atlasDone; });
    await wait(20);
    check('loads discovered by a load are waited for too',
        tracker.total === 2 && tracker.done === 1 && !tracker.settled,
        `${tracker.done}/${tracker.total}`);
    atlas.open();
    const result = await finished;
    check('and finished() fires once they are in', !early && result.total === 2 && result.failed === 0);
}

{
    const empty = await new LoadTracker().finished();
    check('nothing to load finishes at once', empty.total === 0 && !empty.timedOut);
}

{
    const tracker = new LoadTracker({ stallMs: 30, maxMs: 0 });
    tracker.track('fine', Promise.resolve(true));
    tracker.track('lost request', new Promise(noop));
    quiet();
    const result = await tracker.finished();
    loud();
    check('a load that never settles is abandoned after a stall',
        result.timedOut && result.pending.join() === 'lost request', JSON.stringify(result));
}

{
    // Steady progress resets the stall timer, so only the overall deadline
    // can end this one.
    const tracker = new LoadTracker({ stallMs: 40, maxMs: 120 });
    for (let i = 1; i <= 20; i++) tracker.track(`slow ${i}`, wait(i * 15).then(() => true));
    const started = Date.now();
    quiet();
    const result = await tracker.finished();
    loud();
    const took = Date.now() - started;
    check('loads that keep trickling in are waited for past the stall time',
        result.loaded >= 5, `${result.loaded} loaded`);
    check('but not past the overall deadline', result.timedOut && took < 250, `${took}ms`);
}

{
    const tracker = new LoadTracker({ onProgress: () => { throw new Error('bad bar'); } });
    quiet();
    tracker.track('a', Promise.resolve(true));
    const result = await tracker.finished();
    loud();
    check('a broken progress callback does not stop loading', result.loaded === 1);
}

/**
 * A stand-in for a pack download from js/asset-pack.js: bytes are fed in by
 * hand, and it finishes (or fails) when told to.
 */
function fakeDownload() {
    const listeners = [];
    let finish;
    return {
        ready: new Promise((resolve) => { finish = resolve; }),
        onProgress(fn) { listeners.push(fn); fn(0, 0); },
        feed(loaded, total) { listeners.forEach((fn) => fn(loaded, total)); },
        finish(value) { finish(value); },
    };
}

{
    // Two downloads and two ordinary steps. The bar should follow the bytes.
    const seen = [];
    const tracker = new LoadTracker({ stepBytes: 100, onProgress: (p) => seen.push({ ...p }) });
    const big = fakeDownload();
    const small = fakeDownload();
    tracker.trackDownload('big pack', big);
    tracker.trackDownload('small pack', small);
    tracker.track('step 1', Promise.resolve(true));
    const step2 = gate();
    tracker.track('step 2', step2.promise.then(() => true));
    const finished = tracker.finished();
    await wait(1);
    check('the bar holds while a download\'s size is unknown',
        tracker.done === 1 && tracker.fraction === 0, String(tracker.fraction));

    small.feed(0, 1000);            // sized, nothing in yet
    check('until every download has one', tracker.fraction === 0, String(tracker.fraction));
    big.feed(500, 9000);
    const afterSize = tracker.fraction;
    check('then it measures against the whole', Math.abs(afterSize - 600 / 10200) < 1e-9, String(afterSize));
    big.feed(4500, 9000);
    const halfway = tracker.fraction;
    // 4500 + 0 + 100 bytes' worth done of 9000 + 1000 + 200
    check('downloads are counted by their bytes',
        Math.abs(halfway - 4600 / 10200) < 1e-9, String(halfway));
    check('the bytes are reported with the counts',
        seen.at(-1).bytesLoaded === 4500 && seen.at(-1).bytesTotal === 10000,
        JSON.stringify(seen.at(-1)));
    check('the bar never runs backwards as sizes become known',
        seen.every((p, i) => i === 0 || p.fraction >= seen[i - 1].fraction) && afterSize <= halfway);

    big.feed(9000, 9000);
    big.finish({ pack: true });
    small.finish(null);             // a pack that never arrived
    step2.open();
    const result = await finished;
    check('a failed download counts as done, and as failed',
        result.total === 4 && result.failed === 1
        && tracker.failures.join() === 'small pack', JSON.stringify(result));
    check('and the bar still reaches the end', tracker.fraction === 1 && seen.at(-1).fraction === 1);
}

{
    // A single big download on a slow line: nothing *finishes* for longer
    // than the stall time, but bytes keep arriving, so it is not a stall.
    const tracker = new LoadTracker({ stallMs: 40, maxMs: 0 });
    const download = fakeDownload();
    tracker.trackDownload('slow pack', download);
    const finished = tracker.finished();
    for (let i = 1; i <= 6; i++) {
        await wait(15);
        download.feed(i * 100, 600);
    }
    download.finish({ pack: true });
    quiet();
    const result = await finished;
    loud();
    check('bytes still arriving hold off the stall timer', !result.timedOut && result.loaded === 1,
        JSON.stringify(result));
}

{
    const tracker = new LoadTracker({ stallMs: 30, maxMs: 0 });
    const download = fakeDownload();
    tracker.trackDownload('dead pack', download);
    download.feed(50, 600);
    quiet();
    const result = await tracker.finished();
    loud();
    check('a download that stops arriving is abandoned after a stall',
        result.timedOut && result.pending.join() === 'dead pack', JSON.stringify(result));
}

// ---------------------------------------------------------------- 3. Loader hooks

brokenImages.clear();

{
    playerSprites._resetPlayerSpritesForTest();
    check('no player manifest, nothing to preload', playerSprites.preloadPlayerAtlases().length === 0);

    quiet();
    await playerSprites.loadPlayerSpriteManifest('sprites/player/manifest.json');
    loud();
    const tasks = playerSprites.preloadPlayerAtlases();
    const slugs = playerSprites.getPlayerSpriteSlugs();
    check('every player character is preloaded',
        tasks.map((t) => t.name).join() === slugs.join() && slugs.length > 0);
    const images = slugs.map((slug) => playerSprites.getPlayerAtlas(slug));
    const results = await Promise.all(tasks.map((t) => t.ready));
    check('preloading decodes the atlas the renderer will draw, out of the pack',
        images.every((image, i) => image === playerSprites.getPlayerAtlas(slugs[i])
                                   && String(image.src).startsWith('blob:')),
        images.map((image) => image.src).join());
    check('and reports it drawable once it is', results.every(Boolean));
    check('so the player is drawable from the first frame',
        slugs.every((slug) => playerSprites.getPlayerAtlas(slug).naturalHeight > 0));
}

{
    enemySprites._resetEnemySpritesForTest();
    quiet();
    await enemySprites.loadEnemySpriteManifest('sprites/enemies/manifest.json');
    loud();
    const roster = Object.values(MONSTERS).map((def) => def.sprite);
    const unique = [...new Set(roster)];
    const tasks = enemySprites.preloadEnemyAtlases(roster);
    check('the roster\'s enemy atlases are preloaded, once each',
        tasks.length === unique.length && unique.every((slug) => tasks.some((t) => t.name === slug)),
        `${tasks.length} tasks for ${unique.length} characters`);
    check('and only those: the rest of the collection is not downloaded',
        tasks.length < enemySprites.getEnemySpriteSlugs().length);
    check('every one of them becomes drawable', (await Promise.all(tasks.map((t) => t.ready))).every(Boolean));

    // A roster entry the manifest lacks makes Enemy.assignSprite() pick at
    // random from everything, so everything has to be there.
    const all = enemySprites.preloadEnemyAtlases(['zombieman', 'not-a-character']);
    check('a roster character missing from the manifest preloads every atlas',
        all.length === enemySprites.getEnemySpriteSlugs().length);
    await Promise.all(all.map((t) => t.ready));
}

{
    icons._resetItemIconsForTest();
    check('no icon manifest, nothing to preload', icons.preloadItemIcons().length === 0);

    damagedEntries.add('pistol.png');
    quiet();
    await icons.loadItemIcons('sprites/items/manifest.json');
    loud();
    const tasks = icons.preloadItemIcons();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'sprites/items/manifest.json'), 'utf8'));
    check('every item icon is preloaded', tasks.length === Object.keys(manifest.icons).length);
    quiet();
    const results = Object.fromEntries(await Promise.all(
        tasks.map(async (t) => [t.name, await t.ready])));
    loud();
    check('a damaged icon in the pack reports failure without holding the others up',
        results.pistol === false && Object.entries(results).every(([n, ok]) => n === 'pistol' || ok));
    check('and draws as its badge', icons.getItemIcon('pistol') === null && icons.getItemIcon('shotgun') !== null);
    damagedEntries.clear();
}

// ---------------------------------------------------------------- 4. The gate

/**
 * Builds a GameController against fresh loader state, with its manifest
 * fetches and image loads held until the returned release() is called.
 */
function controllerWithHeldAssets() {
    playerSprites._resetPlayerSpritesForTest();
    enemySprites._resetEnemySpritesForTest();
    icons._resetItemIconsForTest();
    elements.clear();
    element('messageOverlay').style.display = 'none';
    element('titleLogo').complete = true;
    element('titleLogo').naturalWidth = 1200;

    const fetches = gate();
    const images = gate();
    fetchGate = fetches.promise;
    imageGate = images.promise;

    quiet();
    console.error = noop;
    const controller = new GameController();
    loud();
    return {
        controller,
        release() { fetches.open(); images.open(); },
    };
}

{
    const { controller, release } = controllerWithHeldAssets();
    const gs = controller.gameState;

    await wait(150);   // Past showStartScreen()'s 100 ms backup timer
    check('the loading screen is up while assets load',
        element('loadingOverlay').style.display !== 'none' && !controller.assetsReady);
    check('the start menu is not shown while assets load',
        element('messageOverlay').style.display === 'none');

    quiet();
    controller.startNewGame();
    loud();
    check('starting a game while loading is refused', !gs.gameRunning && !gs.player);

    quiet();
    release();
    await controller.assetsLoading;
    loud();
    check('the loading screen hands over once everything has loaded',
        controller.assetsReady && element('loadingOverlay').style.display === 'none');
    check('to the start menu', element('messageOverlay').style.display === 'flex');
    check('the loading bar reached 100%',
        element('loadingBarFill').style.width === '100%'
        && element('loadingBar').attributes['aria-valuenow'] === '100',
        element('loadingBarFill').style.width);
    const packBytes = ['sprites/player.pak', 'sprites/enemies.pak', 'sprites/items.pak']
        .reduce((sum, file) => sum + fs.statSync(path.join(root, file)).size, 0);
    check('with the packs\' bytes counted beside it',
        element('loadingCount').textContent === `${(packBytes / 1048576).toFixed(1)} / ${(packBytes / 1048576).toFixed(1)} MB`,
        element('loadingCount').textContent);

    quiet();
    controller.startNewGame();
    loud();
    check('and a game can then start', gs.gameRunning && !!gs.player);
    const atlas = playerSprites.getPlayerAtlas(gs.player.spriteSlug);
    check('with the marine drawable from its first frame, not a dot',
        !!gs.player.getSpriteMeta() && atlas.complete && atlas.naturalHeight > 0);

    gs.gameRunning = false;
    controller.stopRenderLoop?.();
}

{
    // A failed atlas costs that character its artwork, never the session.
    damagedEntries.add('man.png');
    const { controller, release } = controllerWithHeldAssets();
    quiet();
    release();
    await controller.assetsLoading;
    loud();
    check('a damaged atlas still lets the start menu appear',
        controller.assetsReady && element('messageOverlay').style.display === 'flex');

    quiet();
    controller.startNewGame();
    loud();
    check('and the game starts, on the fallback drawing', controller.gameState.gameRunning);
    const atlas = playerSprites.getPlayerAtlas(controller.gameState.player.spriteSlug);
    check('the damaged atlas was never handed to the image decoder', !atlas.src);
    controller.gameState.gameRunning = false;
    damagedEntries.clear();
}

{
    // Every pack missing -- a deploy that forgot them. The manifests are
    // there, so every loader tries, and every one must give up cleanly.
    for (const file of ['sprites/player.pak', 'sprites/enemies.pak',
                        'sprites/enemies-extra.pak', 'sprites/items.pak']) {
        missingFiles.add(file);
    }
    const { controller, release } = controllerWithHeldAssets();
    quiet();
    release();
    await controller.assetsLoading;
    loud();
    check('missing packs still let the start menu appear, without waiting out a timeout',
        controller.assetsReady && element('messageOverlay').style.display === 'flex'
        && element('loadingBarFill').style.width === '100%');

    quiet();
    controller.startNewGame();
    loud();
    check('and the game starts, every character on its fallback drawing',
        controller.gameState.gameRunning
        && !playerSprites.getPlayerAtlas(controller.gameState.player.spriteSlug).src);
    controller.gameState.gameRunning = false;
    missingFiles.clear();
}

// ---------------------------------------------------------------- Result

console.log('');
if (failures === 0) {
    console.log('All loading screen checks passed.');
    process.exit(0);
} else {
    console.error(`${failures} loading screen check(s) FAILED.`);
    process.exit(1);
}
