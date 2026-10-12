// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * The level tally. Run with: npm test
 *
 * Every level ends on a summary -- enemies killed, secrets found, items picked
 * up, time, score -- and the run ends on the totals. These checks drive the
 * real GameState through a level and read the numbers, and the overlay, back.
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
    getElementById: getEl, querySelector: (s) => makeElement(s), querySelectorAll: () => [],
    createElement: () => makeElement('created'), addEventListener: noop, removeEventListener: noop, hidden: false,
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.performance = globalThis.performance || { now: () => 0 };
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.AbortController = globalThis.AbortController || class { constructor() { this.signal = {}; } abort() {} };
globalThis.Image = class { constructor() { this.complete = true; this.naturalHeight = 64; } addEventListener() {} };

const origLog = console.log, origWarn = console.warn;
console.log = noop; console.warn = noop;

const { GameState, formatPlayTime } = await import('../js/game-state.js');
const { HealthPack } = await import('../js/weapons.js');
const {
    TILE_SIZE, MAP_COLS, MAP_ROWS, TILE_EMPTY, TILE_SECRET_DOOR, TILE_KEY_RED, GAME_BALANCE,
} = await import('../js/constants.js');

console.log = origLog; console.warn = origWarn;
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

const quiet = (fn) => { console.log = noop; console.warn = noop; try { return fn(); } finally { console.log = origLog; console.warn = origWarn; } };
const countTiles = (map, tile) => map.flat().filter(t => t === tile).length;
const shown = (id) => getEl(id).style.display !== 'none';

// ---------------------------------------------------------------- the clock
console.log('[1] formatPlayTime reads like a clock...');
check('zero is 0:00', formatPlayTime(0) === '0:00', formatPlayTime(0));
check('61 seconds is 1:01', formatPlayTime(61 * 60) === '1:01', formatPlayTime(61 * 60));
check('an hour rolls over', formatPlayTime(3661 * 60) === '1:01:01', formatPlayTime(3661 * 60));
check('a partial second is dropped, not rounded up', formatPlayTime(119) === '0:01', formatPlayTime(119));

// ---------------------------------------------------------------- a fresh level
console.log('[2] A fresh level starts with a zeroed tally and its secrets counted...');
const gs = new GameState();
quiet(() => { gs.reset(); gs.startGame(); });

let stats = gs.levelStats;
check('kills start at zero', stats.kills === 0);
check('secrets found start at zero', stats.secretsFound === 0);
check('items start at zero', stats.items === 0);
check('the clock starts at zero', stats.frames === 0);
check('secrets total matches the secret doors on the map',
      stats.secretsTotal === countTiles(gs.gameMap, TILE_SECRET_DOOR),
      `${stats.secretsTotal} vs ${countTiles(gs.gameMap, TILE_SECRET_DOOR)}`);
check('a level has secrets to find', stats.secretsTotal > 0);
check('nothing is waiting to continue', gs.awaitingContinue === false);

quiet(() => { gs.update(); gs.update(); gs.update(); });
check('the clock counts frames of play', gs.levelStats.frames === 3, String(gs.levelStats.frames));

// ---------------------------------------------------------------- counting
console.log('[3] Kills, secrets and items are counted as they happen...');
const victim = gs.enemies.find(e => !e.isDead);
check('the level spawned monsters', !!victim);
if (victim) {
    quiet(() => victim.takeDamage(1e9));
    check('a monster dying is a kill', gs.levelStats.kills === 1, String(gs.levelStats.kills));
    quiet(() => victim.takeDamage(1e9));
    check('hitting the body again is not a second kill', gs.levelStats.kills === 1, String(gs.levelStats.kills));
}

const player = gs.player;
const pc = Math.floor(player.x / TILE_SIZE), pr = Math.floor(player.y / TILE_SIZE);
const scoreBefore = gs.score;
gs.gameMap[pr][pc + 1] = TILE_SECRET_DOOR;
quiet(() => player.checkTileInteraction(pc + 1, pr));
check('pushing open a secret door is a secret found', gs.levelStats.secretsFound === 1, String(gs.levelStats.secretsFound));
check('the door gave way', gs.gameMap[pr][pc + 1] === TILE_EMPTY);
check('and it still scores', gs.score === scoreBefore + GAME_BALANCE.SECRET_DOOR_POINTS);

gs.gameMap[pr][pc + 1] = TILE_KEY_RED;
quiet(() => player.checkTileInteraction(pc + 1, pr));
check('a key is an item', gs.levelStats.items === 1, String(gs.levelStats.items));

player.health = 10;
gs.healthPacks.push(new HealthPack(player.x, player.y));
quiet(() => gs.updatePickups());
check('a health pack is an item', gs.levelStats.items === 2, String(gs.levelStats.items));

player.health = player.maxHealth;
gs.healthPacks.push(new HealthPack(player.x, player.y));
quiet(() => gs.updatePickups());
check('a pack left on the ground is not', gs.levelStats.items === 2, String(gs.levelStats.items));

gs.ammoPacks.push({ x: player.x, y: player.y, radius: 10, weaponName: 'Pistol', ammoAmount: 5 });
quiet(() => gs.updatePickups());
check('an ammo pack is an item', gs.levelStats.items === 3, String(gs.levelStats.items));

// ---------------------------------------------------------------- the tally
console.log('[4] Clearing the level shows the tally and waits...');
const mapBefore = gs.gameMap;
const levelBefore = gs.currentLevel;
const living = gs.enemies.filter(e => !e.isDead).length;
const killsBefore = gs.levelStats.kills;
quiet(() => gs.levelComplete());

stats = gs.levelStats;
check('the level number moves on', gs.currentLevel === levelBefore + 1);
check('but the next level has not started', gs.gameMap === mapBefore);
check('the tally is waiting for the player', gs.awaitingContinue === true);
check('the loop is stopped', gs.gameRunning === false);
check('enemies total is kills plus whatever was left alive',
      stats.enemiesTotal === killsBefore + living, `${stats.enemiesTotal} vs ${killsBefore} + ${living}`);
check('the level folded into the run', gs.runStats.levelsCleared === 1 && gs.runStats.kills === killsBefore);
check('folding twice does not double count', (gs.foldLevelIntoRun(), gs.runStats.kills === killsBefore));

check('the overlay is up', shown('messageOverlay'));
check('the title names the level cleared', getEl('messageTitle').textContent === `Level ${levelBefore} Cleared`,
      getEl('messageTitle').textContent);
const html = getEl('levelSummary').innerHTML;
check('the tally is shown', shown('levelSummary'));
check('it lists enemies', html.includes('Enemies killed') && html.includes(`${killsBefore} / ${stats.enemiesTotal}`));
check('it lists secrets', html.includes('Secrets found') && html.includes(`1 / ${stats.secretsTotal}`));
check('it lists items', html.includes('Items picked up') && html.includes('>3<'));
check('it lists the time', html.includes('Time') && html.includes(formatPlayTime(stats.frames)));
check('it lists the score', html.includes('Score') && html.includes(String(gs.score)));
check('Continue is the button on offer', shown('continueButton') && !shown('restartButton'));
check('no difficulty picker mid-run', !shown('difficultySelection'));
check('the hint says how to go on', /Enter/.test(getEl('overlayHint').textContent));

// ---------------------------------------------------------------- continuing
console.log('[5] Continuing starts the next level with a fresh tally...');
const started = quiet(() => gs.continueToNextLevel());
check('continue starts the level', started === true);
check('nothing is waiting any more', gs.awaitingContinue === false);
check('a new map was generated', gs.gameMap !== mapBefore);
check('the level is running', gs.gameRunning === true);
check('the overlay is gone', !shown('messageOverlay'));
// startGameLoop() runs the first frame at once, so the clock may already read 1
check('the tally is fresh', gs.levelStats.kills === 0 && gs.levelStats.items === 0 && gs.levelStats.frames <= 1,
      JSON.stringify(gs.levelStats));
check('the run keeps its totals', gs.runStats.kills === killsBefore && gs.runStats.items === 3);
check('a second continue does nothing', quiet(() => gs.continueToNextLevel()) === false);

// ---------------------------------------------------------------- game over
console.log('[6] Game Over shows the run, including the level it ended on...');
const next = gs.enemies.find(e => !e.isDead);
if (next) quiet(() => next.takeDamage(1e9));
const totals = gs.getRunTotals();
check('the run total includes the unfinished level', totals.kills === killsBefore + (next ? 1 : 0), String(totals.kills));
check('and its secrets', totals.secretsTotal === gs.runStats.secretsTotal + gs.levelStats.secretsTotal);

quiet(() => gs.showGameOverScreen());
check('the loop is stopped', gs.gameRunning === false && gs.gameOver === true);
check('the title is Game Over', getEl('messageTitle').textContent === 'Game Over');
check('it names the level the player fell on', getEl('messageText').textContent.includes(`Level ${gs.currentLevel}`));
const runHtml = getEl('levelSummary').innerHTML;
check('it shows levels cleared', runHtml.includes('Levels cleared') && runHtml.includes('>1<'));
check('it shows the difficulty', runHtml.includes('Medium'));
check('it shows the run kills', runHtml.includes(`${totals.kills} / ${totals.enemiesTotal}`));
check('it shows the final score', runHtml.includes('Final score'));
check('Restart is the button on offer', shown('restartButton') && !shown('continueButton'));
// Game Over offers two things and no more: play again, or go back to the menu.
check('Main Menu is the only other button', shown('mainMenuButton'));
check('no difficulty picker and no instructions here',
    !shown('difficultySelection') && !shown('instructionsButton'));
check('continue is refused over a dead player', quiet(() => gs.continueToNextLevel()) === false);

// ---------------------------------------------------------------- start over
console.log('[7] The start screen and a new run start clean...');
quiet(() => gs.showStartScreen());
check('no tally on the start screen', !shown('levelSummary'));
check('Start is the button', shown('restartButton') && getEl('restartButton').textContent === 'Start Game');
check('with the difficulty picker', shown('difficultySelection'));

quiet(() => { gs.reset(); gs.startGame(); });
check('a new run has no levels cleared', gs.runStats.levelsCleared === 0 && gs.runStats.kills === 0);
check('and a fresh level tally', gs.levelStats.kills === 0 && gs.levelStats.secretsFound === 0);
quiet(() => gs.reset());

console.log('');
console.log(failures === 0 ? 'level tally: all checks passed' : `level tally: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
