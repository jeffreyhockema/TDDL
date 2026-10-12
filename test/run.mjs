// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Test runner. Executes each suite in its own child process, because the suites
 * install conflicting DOM/Canvas stubs on globalThis and must not share a realm.
 *
 * Run with: npm test
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
    { name: 'gameplay', file: 'smoke.mjs' },
    { name: 'level layout', file: 'level-layout.test.mjs' },
    { name: 'lighting', file: 'lighting.test.mjs' },
    { name: 'rendering', file: 'render.test.mjs' },
    { name: 'visibility', file: 'visibility.test.mjs' },
    { name: 'stability', file: 'stability.test.mjs' },
    { name: 'terrain', file: 'terrain.test.mjs' },
    { name: 'enemy sprites', file: 'enemy-sprites.test.mjs' },
    { name: 'monsters', file: 'monsters.test.mjs' },
    { name: 'hit detection', file: 'hitbox.test.mjs' },
    { name: 'particles', file: 'particles.test.mjs' },
    { name: 'doors', file: 'doors.test.mjs' },
    { name: 'traps', file: 'traps.test.mjs' },
    { name: 'decor', file: 'decor.test.mjs' },
    { name: 'barrels', file: 'barrels.test.mjs' },
    { name: 'switches', file: 'switches.test.mjs' },
    { name: 'sector lighting', file: 'sectors.test.mjs' },
    { name: 'windows', file: 'windows.test.mjs' },
    { name: 'arsenal', file: 'arsenal.test.mjs' },
    { name: 'player sprites', file: 'player-sprites.test.mjs' },
    { name: 'audio', file: 'audio.test.mjs' },
    { name: 'pickups', file: 'pickups.test.mjs' },
    { name: 'level tally', file: 'level-summary.test.mjs' },
    { name: 'touch controls', file: 'touch.test.mjs' },
    { name: 'loading screen', file: 'preloader.test.mjs' },
    { name: 'cheats', file: 'cheats.test.mjs' },
    { name: 'armor', file: 'armor.test.mjs' },
    { name: 'mouse wheel', file: 'wheel.test.mjs' },
    { name: 'pause menu', file: 'pause.test.mjs' },
    { name: 'status bar', file: 'hud.test.mjs' },
    { name: 'game controllers', file: 'gamepad.test.mjs' },
    { name: 'asset packs', file: 'asset-pack.test.mjs' },
];

let failed = 0;

for (const suite of SUITES) {
    const result = spawnSync(process.execPath, [path.join(here, suite.file)], {
        stdio: 'inherit',
    });

    if (result.status !== 0) {
        console.error(`\n>>> suite "${suite.name}" FAILED (exit ${result.status})\n`);
        failed++;
    }
}

console.log('');
if (failed === 0) {
    console.log(`All ${SUITES.length} suites passed.`);
} else {
    console.log(`${failed} of ${SUITES.length} suites FAILED.`);
}
process.exit(failed === 0 ? 0 : 1);
