// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Asset pack checks. Run with: npm test
 *
 * The sprites and sounds ship only as packs (js/asset-pack.js, built by
 * tools/pack_assets.py), so a pack the game cannot read is a game with no art
 * and no sound. These check:
 *
 *   1. The format -- packing and unpacking round-trips byte for byte, for
 *      every awkward length the keystream has to handle.
 *
 *   2. The scrambling does its one job: no PNG or RIFF/WAVE signature, and no
 *      entry name, survives into a pack.
 *
 *   3. Damage is caught, not decoded -- truncated, padded, wrong-version and
 *      bit-flipped packs all fail with a PackError saying which, and a damaged
 *      entry fails alone while the rest of its pack still reads.
 *
 *   4. The committed packs -- each reads, every entry passes its checksum,
 *      re-encoding it here gives the identical file (so the Python packer and
 *      this decoder agree on the format, and packing is deterministic), and the
 *      enemy packs split along the bestiary's roster. Where the raw build
 *      output is present (a working checkout, not a fresh clone) the packs are
 *      also checked to be current with it.
 *
 *   5. The browser loader -- one download however many ask, bytes reported as
 *      they stream with the total from the pack's own header, and a missing or
 *      damaged pack resolving to null instead of throwing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PACK_FILES, root, loadPack } from './pack-files.mjs';

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

// ---------------------------------------------------------------- Image stub
//
// loadPackedImage() makes Image elements. This one "loads" any blob URL
// asynchronously, which is all the loader needs to see.

globalThis.Image = class {
    constructor() {
        this.complete = false;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
        this.listeners = { load: [], error: [] };
        this._src = '';
    }
    get src() { return this._src; }
    set src(value) {
        this._src = value;
        setTimeout(() => {
            this.complete = true;
            this.naturalWidth = this.naturalHeight = 64;
            this.listeners.load.forEach((fn) => fn());
        }, 0);
    }
    addEventListener(type, fn) { this.listeners[type]?.push(fn); }
};

const pack = await import('../js/asset-pack.js');
const { MONSTERS } = await import('../js/monsters.js');
const {
    PackError, PACK_HEADER_SIZE, crc32, scramble, encodePack, parsePack, readEntry,
    declaredPackSize, openPack, loadPackedImage, _resetPacksForTest,
} = pack;

console.log('\n=== asset packs ===\n');

/** Bytes as text, for signature searches. */
const latin1 = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');

/** Runs fn and returns the PackError it throws, or null. */
function packError(fn) {
    try {
        fn();
        return null;
    } catch (error) {
        return error instanceof PackError ? error : { code: `not a PackError: ${error}` };
    }
}

/** Deterministic filler bytes, so failures reproduce. */
function filler(length, seed) {
    const out = new Uint8Array(length);
    let x = seed | 1;
    for (let i = 0; i < length; i++) {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        out[i] = x >>> 24;
    }
    return out;
}

/** A minimal PNG-looking file: signature, IHDR, then filler. */
function fakePng(seed) {
    const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
                  0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64, 0, 0, 0, 64];
    const out = new Uint8Array(300);
    out.set(head);
    out.set(filler(300 - head.length, seed), head.length);
    return out;
}

/** A minimal WAV-looking file: RIFF/WAVE/fmt /data, then filler. */
function fakeWav(seed) {
    const out = new Uint8Array(400);
    out.set(new TextEncoder().encode('RIFF\x88\x01\x00\x00WAVEfmt '));
    out.set(new TextEncoder().encode('data'), 36);
    out.set(filler(400 - 44, seed), 44);
    return out;
}

// ---------------------------------------------------------------- 1. Round trip

check('CRC-32 matches the standard check value',
    crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);

{
    const plain = filler(37, 7);
    const twice = scramble(scramble(plain, 'x.png'), 'x.png');
    check('scrambling is its own inverse', Buffer.compare(twice, plain) === 0);
    check('different names give different keystreams',
        Buffer.compare(scramble(plain, 'a.png'), scramble(plain, 'b.png')) !== 0);
    // The output must own its buffer exactly: decodeAudioData() takes, and
    // detaches, the whole ArrayBuffer it is given.
    const out = scramble(plain.subarray(3, 20), 'x.png');
    check('scrambled output has a buffer of its own',
        out.byteOffset === 0 && out.buffer.byteLength === 17);
}

{
    // Every length mod 4, empty included: the keystream is generated a word
    // at a time and the tail is where an off-by-one would hide.
    const files = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1023, 4096].map((length, i) => ({
        name: `file-${String(i).padStart(2, '0')}.bin`, type: 'application/octet-stream',
        bytes: filler(length, i + 1),
    }));
    files.push({ name: 'sprite.png', type: 'image/png', bytes: fakePng(3) });
    files.push({ name: 'sound.wav', type: 'audio/wav', bytes: fakeWav(4) });

    const built = encodePack(files);
    const parsed = parsePack(built);
    const mismatched = files.filter((f) => Buffer.compare(readEntry(parsed, f.name), f.bytes) !== 0);
    check('pack then unpack gives identical bytes, at every awkward length',
        mismatched.length === 0 && parsed.entries.size === files.length,
        mismatched.map((f) => f.name).join(', '));
    check('entries keep their MIME types',
        parsed.entries.get('sprite.png').type === 'image/png' && parsed.entries.get('sound.wav').type === 'audio/wav');
    check('the declared size is readable from the header alone',
        declaredPackSize(built.subarray(0, PACK_HEADER_SIZE)) === built.length);
    check('packing is deterministic, whatever order the files come in',
        Buffer.compare(encodePack([...files].reverse()), built) === 0);
    check('an ArrayBuffer parses as well as a Uint8Array',
        parsePack(built.slice().buffer).entries.size === files.length);

    // ------------------------------------------------------------ 2. Disguise

    const text = latin1(built);
    check('a scrambled PNG keeps no PNG signature', !text.includes('\x89PNG') && !text.includes('IHDR'));
    check('a scrambled WAV keeps no RIFF/WAVE signature', !text.includes('RIFF') && !text.includes('WAVE'));
    check('entry names are not readable in the pack', !text.includes('sprite.png') && !text.includes('.wav'));

    // ------------------------------------------------------------ 3. Damage

    const errorFor = (bytes) => packError(() => parsePack(bytes));

    check('an empty file fails cleanly', errorFor(new Uint8Array(0))?.code === 'truncated');
    check('a truncated header fails cleanly', errorFor(built.subarray(0, 10))?.code === 'truncated');

    const truncatedAt = [PACK_HEADER_SIZE, PACK_HEADER_SIZE + 5, built.length >> 1, built.length - 1]
        .map((n) => errorFor(built.subarray(0, n))?.code);
    check('a pack cut short anywhere fails cleanly', truncatedAt.every((code) => code === 'truncated'),
        truncatedAt.join());

    const padded = new Uint8Array(built.length + 3);
    padded.set(built);
    check('a pack with bytes added fails cleanly', errorFor(padded)?.code === 'corrupt');

    const notAPack = built.slice();
    notAPack[0] = 0x89;
    check('something that is not a pack is refused', errorFor(notAPack)?.code === 'format');

    const future = built.slice();
    future[4] = 99;
    check('a pack from a newer format is refused', errorFor(future)?.code === 'version');

    const badIndex = built.slice();
    badIndex[PACK_HEADER_SIZE + 3] ^= 0x40;
    check('a damaged index fails cleanly', errorFor(badIndex)?.code === 'corrupt');

    const badSize = built.slice();
    new DataView(badSize.buffer).setUint32(12, built.length, true);
    check('an index length past the end fails cleanly', errorFor(badSize)?.code === 'corrupt');

    const badEntry = built.slice();
    const victim = parsed.entries.get('sprite.png');
    badEntry[victim.offset + 100] ^= 0x01;
    const damaged = parsePack(badEntry);
    check('a damaged entry fails its checksum',
        packError(() => readEntry(damaged, 'sprite.png'))?.code === 'corrupt');
    check('while the rest of its pack still reads',
        Buffer.compare(readEntry(damaged, 'sound.wav'), fakeWav(4)) === 0);
    check('asking for an entry that is not there fails cleanly',
        packError(() => readEntry(parsed, 'nope.png'))?.code === 'missing');
}

// ---------------------------------------------------------------- 4. The committed packs

const SIGNATURES = {
    'PNG signature': '\x89PNG\r\n\x1a\n',
    'PNG header chunk': '\x00\x00\x00\x0dIHDR',
    'RIFF/WAVE header': 'WAVEfmt ',
};

const expectedType = { '.png': 'image/png', '.wav': 'audio/wav' };

/** Where each pack's raw inputs live, for the staleness check. */
const RAW_DIRS = {
    [PACK_FILES.player]: 'sprites/player',
    [PACK_FILES.items]: 'sprites/items',
    [PACK_FILES.enemies]: 'sprites/enemies',
    [PACK_FILES.enemiesExtra]: 'sprites/enemies',
    [PACK_FILES.sounds]: 'sounds',
};

let rawChecked = 0;
for (const file of Object.values(PACK_FILES)) {
    let parsed = null;
    const error = packError(() => { parsed = loadPack(file); });
    check(`${file} reads`, parsed && !error, error ? error.message || error.code : 'file missing');
    if (!parsed) continue;

    const bytes = fs.readFileSync(path.join(root, file));
    const files = [];
    const bad = [];
    for (const name of parsed.entries.keys()) {
        try {
            const data = readEntry(parsed, name);
            files.push({ name, type: parsed.entries.get(name).type, bytes: data });
            if (parsed.entries.get(name).type !== expectedType[path.extname(name)]) bad.push(`${name}: type`);
        } catch (e) {
            bad.push(`${name}: ${e.message}`);
        }
    }
    check(`${file}: all ${parsed.entries.size} entries pass their checksums and are typed`,
        bad.length === 0 && parsed.entries.size > 0, bad.slice(0, 3).join('; '));

    check(`${file}: re-encoding it gives the identical file`,
        Buffer.compare(encodePack(files), bytes) === 0);

    const text = latin1(bytes);
    const found = Object.entries(SIGNATURES).filter(([, sig]) => text.includes(sig)).map(([what]) => what);
    const names = [...parsed.entries.keys()].filter((name) => text.includes(name));
    check(`${file}: no PNG or WAV signature and no entry name shows through`,
        found.length === 0 && names.length === 0, [...found, ...names.slice(0, 3)].join(', '));

    // A working checkout has the build output beside the packs. If it is
    // there, the pack must match it: a rebuild without a repack is caught
    // here rather than in a deploy. A fresh clone has none, by design.
    const rawDir = path.join(root, RAW_DIRS[file]);
    const stale = files.filter((f) => {
        const raw = path.join(rawDir, f.name);
        return fs.existsSync(raw) && Buffer.compare(fs.readFileSync(raw), f.bytes) !== 0;
    });
    if (files.some((f) => fs.existsSync(path.join(rawDir, f.name)))) {
        rawChecked++;
        check(`${file}: matches the raw build output (run tools/pack_assets.py if not)`,
            stale.length === 0, stale.map((f) => f.name).slice(0, 5).join(', '));
    }
}

{
    // The enemy packs split along the roster: everything the bestiary wears in
    // the pack that is always downloaded, the rest in the one that is not.
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'sprites/enemies/manifest.json'), 'utf8'));
    const main = loadPack(PACK_FILES.enemies);
    const extra = loadPack(PACK_FILES.enemiesExtra);
    const roster = new Set(Object.values(MONSTERS).map((def) => def.sprite));
    const files = (slugs) => [...slugs].map((slug) => manifest.characters[slug]?.file);

    const notInMain = files(roster).filter((f) => !main?.entries.has(f));
    check('every character the bestiary wears is in the main enemy pack', notInMain.length === 0,
        notInMain.join(', '));
    check('and nothing else is', main?.entries.size === roster.size,
        `${main?.entries.size} entries for ${roster.size} characters`);
    const everyone = files(Object.keys(manifest.characters));
    const nowhere = everyone.filter((f) => !main?.entries.has(f) && !extra?.entries.has(f));
    const both = everyone.filter((f) => main?.entries.has(f) && extra?.entries.has(f));
    check('the two enemy packs hold every character in the manifest exactly once',
        nowhere.length === 0 && both.length === 0 && main.entries.size + extra.entries.size === everyone.length,
        [...nowhere, ...both].join(', '));
}

if (rawChecked === 0) {
    console.log('  --    no raw build output here (a fresh clone); skipped the staleness check');
} else {
    // And the other way: a file the build tools wrote that no pack carries
    // would never reach a browser.
    const unpacked = [];
    for (const dir of new Set(Object.values(RAW_DIRS))) {
        const packs = Object.entries(RAW_DIRS).filter(([, d]) => d === dir).map(([file]) => loadPack(file));
        for (const name of fs.readdirSync(path.join(root, dir))) {
            if (!expectedType[path.extname(name)]) continue;
            if (!packs.some((p) => p?.entries.has(name))) unpacked.push(`${dir}/${name}`);
        }
    }
    check('every raw asset the build wrote is in a pack (run tools/pack_assets.py if not)',
        unpacked.length === 0, unpacked.slice(0, 5).join(', '));
}

// ---------------------------------------------------------------- 5. The loader

/** What the fake server holds, by URL. */
const served = new Map();
let fetches = 0;

/**
 * A fetch() with a streaming body that dribbles the bytes out in small chunks,
 * and no Content-Length -- the case where only the pack's header gives the size.
 */
globalThis.fetch = async (url) => {
    fetches++;
    const bytes = served.get(url);
    if (!bytes) return { ok: false, status: 404 };
    return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: new ReadableStream({
            start(controller) {
                for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7));
                controller.close();
            },
        }),
    };
};

const quietly = async (fn) => {
    const warn = console.warn;
    console.warn = noop;
    try { return await fn(); } finally { console.warn = warn; }
};

{
    const files = [
        { name: 'a.png', type: 'image/png', bytes: fakePng(1) },
        { name: 'b.wav', type: 'audio/wav', bytes: fakeWav(2) },
    ];
    const built = encodePack(files);
    served.set('good.pak', built);

    const seen = [];
    const load = openPack('good.pak');
    load.onProgress((loaded, total) => seen.push([loaded, total]));
    check('asking twice shares one download', openPack('good.pak') === load);
    const parsed = await load.ready;
    check('a pack downloads and parses', parsed && parsed.entries.size === 2);
    check('it was fetched once', fetches === 1, `${fetches} fetches`);
    check('bytes are reported as they stream in', seen.length > 10, `${seen.length} reports`);
    check('with the total taken from the pack\'s own header',
        seen.filter(([loaded]) => loaded >= PACK_HEADER_SIZE).every(([, total]) => total === built.length));
    check('and they only ever go forwards, ending at the whole pack',
        seen.every(([loaded], i) => i === 0 || loaded >= seen[i - 1][0])
        && seen.at(-1)[0] === built.length && seen.at(-1)[1] === built.length);

    const late = [];
    load.onProgress((loaded, total) => late.push([loaded, total]));
    check('a late subscriber is told where things stand', late.length === 1 && late[0][0] === built.length);

    const { image, ready } = loadPackedImage(load.ready, 'a.png', 'Test');
    check('an image entry becomes a drawable Image from a blob URL',
        (await ready) === true && String(image.src).startsWith('blob:') && image.naturalWidth > 0);

    const missing = await quietly(() => loadPackedImage(load.ready, 'nope.png', 'Test').ready);
    check('an entry the pack lacks fails cleanly', missing === false);
}

{
    const result = await quietly(() => openPack('absent.pak').ready);
    check('a missing pack resolves to null rather than throwing', result === null);
    const { image, ready } = loadPackedImage(openPack('absent.pak').ready, 'a.png', 'Test');
    check('and its images fail without ever being given a source', (await ready) === false && !image.src);

    const broken = encodePack([{ name: 'a.png', type: 'image/png', bytes: fakePng(1) }]);
    served.set('cut.pak', broken.subarray(0, broken.length - 9));
    check('a truncated download resolves to null rather than throwing',
        (await quietly(() => openPack('cut.pak').ready)) === null);

    _resetPacksForTest();
    const before = fetches;
    await openPack('good.pak').ready;
    check('the test hook forgets downloads, so the next ask fetches afresh', fetches === before + 1);
}

// ---------------------------------------------------------------- Result

console.log('');
if (failures === 0) {
    console.log('All asset pack checks passed.');
    process.exit(0);
} else {
    console.error(`${failures} asset pack check(s) FAILED.`);
    process.exit(1);
}
