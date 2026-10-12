// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Helpers for the suites that check the shipped art and sound.
 *
 * Not a suite itself. The repository holds the sprites and sounds only as
 * packs (see js/asset-pack.js); the loose PNGs and WAVs the build tools write
 * are git-ignored, so a fresh clone does not have them. Suites that inspect
 * the assets read them out of the packs through these, which is also the path
 * the game itself takes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePack, readEntry } from '../js/asset-pack.js';

/** The project root. */
export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every pack the game ships, relative to the root. */
export const PACK_FILES = {
    player: 'sprites/player.pak',
    items: 'sprites/items.pak',
    enemies: 'sprites/enemies.pak',
    enemiesExtra: 'sprites/enemies-extra.pak',
    sounds: 'sounds/sounds.pak',
};

/** Parsed packs by path, so each is read off disk once per suite. */
const cache = new Map();

/**
 * @param {string} rel - Pack path relative to the root
 * @returns {import('../js/asset-pack.js').ParsedPack|null} The pack, or null if the file is absent
 */
export function loadPack(rel) {
    if (!cache.has(rel)) {
        const file = path.join(root, rel);
        cache.set(rel, fs.existsSync(file) ? parsePack(fs.readFileSync(file)) : null);
    }
    return cache.get(rel);
}

/**
 * Reads one file out of whichever of the given packs holds it.
 *
 * @param {string|string[]} rels - Pack path(s), searched in order
 * @param {string} name - Entry name, e.g. "man.png"
 * @returns {Uint8Array|null} Its bytes, or null if no pack has it
 */
export function packedFile(rels, name) {
    for (const rel of [].concat(rels)) {
        const pack = loadPack(rel);
        if (pack && pack.entries.has(name)) return readEntry(pack, name);
    }
    return null;
}

/**
 * Reads width and height out of a PNG's IHDR without decoding the image.
 *
 * @param {Uint8Array} bytes - The PNG
 * @returns {{width: number, height: number}}
 */
export function pngSize(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * A fetch() that serves files off disk the way a static server would: JSON
 * for the manifests, bytes for everything else. Without a `body` stream, so the
 * pack loader takes its arrayBuffer() path.
 *
 * @param {Object} [options]
 * @param {(url: string) => Promise<void>|void} [options.before] - Awaited first,
 *        so a suite can hold requests in flight
 * @param {(url: string, bytes: Uint8Array) => Uint8Array|null} [options.rewrite] -
 *        Lets a suite damage or withhold (null: 404) what is served
 * @returns {(url: string) => Promise<Object>}
 */
export function diskFetch(options = {}) {
    return async (url) => {
        if (options.before) await options.before(String(url));
        const file = path.join(root, String(url));
        if (!fs.existsSync(file)) return { ok: false, status: 404 };
        let bytes = new Uint8Array(fs.readFileSync(file));
        if (options.rewrite) bytes = options.rewrite(String(url), bytes);
        if (!bytes) return { ok: false, status: 404 };
        return {
            ok: true,
            status: 200,
            json: async () => JSON.parse(new TextDecoder().decode(bytes)),
            arrayBuffer: async () => bytes.slice().buffer,
        };
    };
}
