// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Headless smoke test for the TDDL game logic.  Run with: npm test
 *
 * Stubs just enough DOM/Canvas to let game-state.js drive real levels in Node,
 * then runs many simulated frames across many levels looking for exceptions, NaN
 * state, unbounded growth, and the specific regressions the review turned up.
 */

// ---------------------------------------------------------------- DOM/Canvas stubs
const noop = () => {};
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
  const el = {
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
  return el;
}

const elements = new Map();
const getEl = (id) => {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
};

globalThis.window = globalThis;
globalThis.document = {
  getElementById: getEl,
  querySelector: (s) => makeElement(s),
  querySelectorAll: () => [],
  createElement: () => makeElement('created'),
  addEventListener: noop,
  removeEventListener: noop,
  hidden: false,
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.performance = globalThis.performance || { now: () => 0 };
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.AbortController = globalThis.AbortController || class { constructor() { this.signal = {}; } abort() {} };

// No audio stub is needed: with no AudioContext in Node, every entry point in
// audio-system.js is a no-op. That is the same path a browser without Web Audio
// takes, so leaving it unstubbed is the more useful test.

// ---------------------------------------------------------------- Load the game
const failures = [];
const record = (msg) => { failures.push(msg); console.error('  FAIL: ' + msg); };

const origError = console.error;
const origWarn = console.warn;
const origLog = console.log;
console.log = noop;
console.warn = noop;
console.error = (...a) => { origError('  [game console.error]', ...a); };

const { GameState } = await import('../js/game-state.js');
const { Bullet, Explosion, applyBulletHit, HealthPack } = await import('../js/weapons.js');
const { checkWallCollision, isSolidTile } = await import('../js/utils.js');
const { keys, mouse } = await import('../js/input-handler.js');
const { registerDoors, doorAtTile, updateDoors, DOORS } = await import('../js/doors.js');
const { Enemy } = await import('../js/entities.js');
const { PLAYER_DEATH_BEAT, MAP_COLS, MAP_ROWS } = await import('../js/constants.js');

console.log = origLog;
console.warn = origWarn;

// Minimal gameController stand-in used by aiming/fog code
globalThis.gameController = { canvas: { width: 1200, height: 800 }, zoomLevel: 1, zoomIn: noop, zoomOut: noop };

// ---------------------------------------------------------------- Tests
console.log('\n=== TDDL headless smoke test ===\n');

const gs = new GameState();
gs.selectedDifficulty = 'medium';

// --- 1. Run many levels of real gameplay ---
console.log('[1] Simulating gameplay across levels...');
console.log = noop;
gs.startGame();
console.log = origLog;

let framesRun = 0;
let maxBullets = 0, maxEnemies = 0, maxEffects = 0, maxExplosions = 0;

for (let level = 1; level <= 12; level++) {
  console.log = noop;
  gs.currentLevel = level;
  gs.isLevelCompleting = false;
  gs.gameRunning = true;
  try {
    gs.initLevel();
  } catch (e) {
    console.log = origLog;
    record(`initLevel threw on level ${level}: ${e.message}`);
    continue;
  }
  console.log = origLog;

  // Player fires constantly and moves, to exercise weapons/collision
  mouse.down = true;
  keys.w = true; keys.d = true;
  if (gs.player) gs.player.collectAllGuns();

  for (let f = 0; f < 220; f++) {
    try {
      gs.frameCount++;
      gs.update();
      framesRun++;
    } catch (e) {
      record(`update() threw on level ${level} frame ${f}: ${e.message}\n${e.stack?.split('\n')[1] || ''}`);
      break;
    }
    maxBullets = Math.max(maxBullets, gs.bullets.length);
    maxEnemies = Math.max(maxEnemies, gs.enemies.length);
    maxEffects = Math.max(maxEffects, gs.temporaryVisualEffects.length);
    maxExplosions = Math.max(maxExplosions, gs.explosions.length);

    if (gs.player && (Number.isNaN(gs.player.x) || Number.isNaN(gs.player.y))) {
      record(`player position became NaN on level ${level} frame ${f}`); break;
    }
    if (gs.player && Number.isNaN(gs.player.health)) {
      record(`player health became NaN on level ${level} frame ${f}`); break;
    }
    for (const e of gs.enemies) {
      if (Number.isNaN(e.health)) { record(`enemy health became NaN on level ${level} frame ${f}`); break; }
    }
    gs.player.health = gs.player.maxHealth; // keep the sim alive
    gs.gameOver = false;
  }
  keys.w = false; keys.d = false;
  mouse.down = false;
}
console.log(`  ran ${framesRun} frames; peaks -> bullets:${maxBullets} enemies:${maxEnemies} effects:${maxEffects} explosions:${maxExplosions}`);
if (maxBullets > 4000) record(`bullet array grew unbounded (${maxBullets})`);
if (maxEffects > 4000) record(`visual effects grew unbounded (${maxEffects})`);

// --- 2. BFG tracerDamage must be a number, not a function ---
console.log('[2] BFG tracerDamage is numeric...');
{
  const bfg = gs.player.weapons.find(w => w.name === 'BFG');
  if (!bfg) record('BFG weapon missing from inventory');
  else if (typeof bfg.tracerDamage !== 'number') {
    record(`BFG tracerDamage is ${typeof bfg.tracerDamage}, expected number (this NaNs enemy health)`);
  } else console.log(`  tracerDamage = ${bfg.tracerDamage}`);
  if (typeof bfg?.damage !== 'number') record(`BFG damage is ${typeof bfg?.damage}`);
}

// --- 3. Enemy dies exactly once even when hit repeatedly in a frame ---
console.log('[3] Enemy onDeath fires once per death...');
{
  // The Pain Elemental releases Lost Souls when it dies; killing it three
  // times in one frame must not release three sets.
  const e = new Enemy(100, 100, 'pain_elemental');
  gs.enemies.length = 0;
  const scoreBefore = gs.score;
  e.takeDamage(99999);
  e.takeDamage(99999);
  e.takeDamage(99999);
  const gained = gs.score - scoreBefore;
  if (gained !== e.scoreValue) record(`pain elemental awarded ${gained} score, expected ${e.scoreValue} (double-death)`);
  else console.log(`  score awarded once (${gained})`);
  if (gs.enemies.length > 3) record(`pain elemental released ${gs.enemies.length} lost souls, expected at most 3`);
  else console.log(`  released ${gs.enemies.length} lost souls (<=3)`);
}

// --- 4. Weapon damage is Doom's, and never scales with the level ---
console.log("[4] Weapon damage is Doom's at every level...");
{
  gs.currentLevel = 1; gs.player.refreshWeaponDamage();
  const lvl1 = gs.player.weapons.find(w => w.name === 'Pistol').damage;
  gs.currentLevel = 20; gs.player.refreshWeaponDamage();
  const lvl20 = gs.player.weapons.find(w => w.name === 'Pistol').damage;
  if (lvl20 !== lvl1 || lvl1 !== 10) record(`pistol damage should be Doom's 5-15 (average 10) at every level: L1=${lvl1} L20=${lvl20}`);
  else console.log(`  pistol averages ${lvl1} on level 1 and ${lvl20} on level 20`);
  gs.currentLevel = 1; gs.player.refreshWeaponDamage();
}

// --- 5. Doors and large radii block movement ---
console.log('[5] checkWallCollision handles doors and big radii...');
{
  const map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(0));
  map[10][10] = 2; // TILE_DOOR_RED
  if (!checkWallCollision(10 * 40 + 20, 10 * 40 + 20, 13, map)) record('closed red door did not block movement');
  else console.log('  closed door blocks movement');

  const map2 = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(0));
  map2[10][10] = 1; // a wall fully inside a large entity's box
  // Entity centred one tile away with radius 80 (tier-3 boss) must collide
  if (!checkWallCollision(10 * 40 + 20, 10 * 40 + 20, 80, map2)) record('large-radius entity clipped through a wall');
  else console.log('  large-radius entity collides with enclosed wall');
  if (!isSolidTile(5)) record('secret door not treated as solid');
}

// --- 6. Rocket direct hit explodes ---
console.log('[6] Rocket direct hit creates an explosion...');
{
  gs.explosions.length = 0;
  const rocket = new Bullet(100, 100, 0, 5, 'player', 50, '#f00', true, 100, 30);
  const target = { x: 100, y: 100, radius: 10, health: 500, isDead: false, takeDamage(d) { this.health -= d; } };
  applyBulletHit(rocket, target);
  if (gs.explosions.length !== 1) record(`direct rocket hit produced ${gs.explosions.length} explosions, expected 1`);
  else console.log('  direct hit detonates');
}

// --- 7. Explosion expands and uses carried damage ---
console.log('[7] Explosion expands outward and honours its damage value...');
{
  const ex = new Explosion(100, 100, 100, 30, 'orange', 200, true);
  const radii = [];
  gs.player.x = 5000; gs.player.y = 5000; // out of blast range
  gs.enemies.length = 0; gs.currentBoss = null;
  for (let i = 0; i < 30; i++) { ex.update(); radii.push(ex.currentRadius); }
  if (!(radii[2] < radii[20])) record(`explosion radius shrank instead of expanding (${radii[2].toFixed(1)} -> ${radii[20].toFixed(1)})`);
  else console.log(`  radius ${radii[2].toFixed(1)} -> ${radii[20].toFixed(1)} (expanding)`);

  // On open floor: the blast needs line of sight to what it hurts, so a burst
  // inside the map's border rock would hurt nothing
  let floor = { x: 100, y: 100 };
  outer: for (let r = 1; r < gs.gameMap.length; r++) {
    for (let c = 1; c < gs.gameMap[r].length; c++) {
      if (gs.gameMap[r][c] === 0) { floor = { x: c * 40 + 20, y: r * 40 + 20 }; break outer; }
    }
  }
  const ex2 = new Explosion(floor.x, floor.y, 100, 30, 'orange', 200, false);
  const victim = { x: floor.x, y: floor.y, radius: 5, health: 1000, isDead: false, takeDamage(d) { this.health -= d; } };
  gs.enemies.length = 0; gs.enemies.push(victim);
  for (let i = 0; i < 30; i++) ex2.update();
  const dealt = 1000 - victim.health;
  if (dealt < 150) record(`explosion dealt ${dealt}, expected ~200 from its damage value`);
  else console.log(`  dealt ${dealt.toFixed(0)} damage from a 200-damage rocket`);
  gs.enemies.length = 0;
}

// --- 8. Enemy bullets damage the player with no enemies alive ---
console.log('[8] Enemy fire damages the player when no enemies remain...');
{
  gs.enemies.length = 0;
  gs.currentBoss = null;
  gs.player.x = 500; gs.player.y = 500;
  gs.player.health = 500;
  gs.bullets.length = 0;
  gs.bullets.push(new Bullet(500, 500, 0, 1, 'enemy', 25));
  gs.resolveBulletCollisions();
  if (gs.player.health !== 475) record(`player health ${gs.player.health}, expected 475 (bullet did not connect)`);
  else console.log('  in-flight enemy bullet still hits');
  if (gs.bullets.length !== 0) record('bullet was not consumed on hit');
}

// --- 9. One bullet damages the player only once ---
console.log('[9] A single bullet damages the player once...');
{
  gs.enemies.length = 0;
  for (let i = 0; i < 10; i++) gs.enemies.push(new Enemy(2000 + i * 100, 2000, 'zombieman'));
  gs.player.health = 500;
  gs.bullets.length = 0;
  gs.bullets.push(new Bullet(500, 500, 0, 1, 'enemy', 25));
  gs.resolveBulletCollisions();
  const lost = 500 - gs.player.health;
  if (lost !== 25) record(`player lost ${lost} to one bullet with 10 enemies alive, expected 25`);
  else console.log('  one bullet = one hit regardless of enemy count');
  gs.enemies.length = 0;
}

// --- 10. Full-health pickups are not destroyed ---
console.log('[10] Pickups are not consumed when they grant nothing...');
{
  gs.player.health = gs.player.maxHealth;
  gs.player.x = 300; gs.player.y = 300;
  gs.healthPacks.length = 0;
  gs.healthPacks.push(new HealthPack(300, 300));
  gs.updatePickups();
  if (gs.healthPacks.length !== 1) record('health pack consumed at full health');
  else console.log('  medkit left on the ground at full health');
  gs.player.health = 10;
  gs.updatePickups();
  if (gs.healthPacks.length !== 0) record('health pack not consumed when damaged');
  else console.log('  medkit collected when damaged');
}

// --- 11. Mini-boss spawns somewhere walkable ---
console.log('[11] Mini-boss spawns on walkable, reachable ground...');
{
  let bad = 0;
  for (let t = 0; t < 12; t++) {
    console.log = noop;
    gs.currentLevel = 3;
    gs.isBossLevel = false;
    gs.isCurrentLevelMiniBoss = true;
    gs.initLevel();
    console.log = origLog;
    const b = gs.currentBoss;
    if (!b) { bad++; continue; }
    const tx = Math.floor(b.x / 40), ty = Math.floor(b.y / 40);
    if (ty < 0 || ty >= MAP_ROWS || tx < 0 || tx >= MAP_COLS || gs.gameMap[ty][tx] === 1) bad++;
    else {
      const reachable = gs.getReachableTiles();
      if (!reachable.has(ty * MAP_COLS + tx)) bad++;
    }
  }
  if (bad > 0) record(`${bad}/12 mini-boss spawns landed in rock or unreachable space`);
  else console.log('  12/12 spawns walkable and reachable from the player');
}

// --- 12. Restart clears latched input ---
console.log('[12] Restart clears latched input...');
{
  keys.w = true; mouse.down = true;
  console.log = noop; gs.reset(); console.log = origLog;
  if (keys.w || mouse.down) record('reset() left input latched (player moves/fires on restart)');
  else console.log('  keys and mouse cleared');
  if (gs.nextMiniBossSpawnLevel !== 0) record('reset() left nextMiniBossSpawnLevel set');
}


// --- 13. Boss levels gate the exit on the boss ---
console.log('[13] Exit is sealed while a boss lives...');
{
  console.log = noop;
  gs.startGame();               // test 12 called reset(), which nulls the player
  gs.gameOver = false;
  gs.currentLevel = 5;          // boss level
  gs.isBossLevel = true;
  gs.initLevel();
  console.log = origLog;

  if (!gs.currentBoss) {
    record('level 5 produced no boss');
  } else {
    // Find the exit tile and try to walk onto it with the boss alive
    let exit = null;
    for (let r = 0; r < MAP_ROWS && !exit; r++)
      for (let c = 0; c < MAP_COLS; c++) if (gs.gameMap[r][c] === 14) { exit = { r, c }; break; }

    if (!exit) {
      console.log('  (no exit tile on this boss level - nothing to gate)');
    } else {
      gs.isLevelCompleting = false;
      const levelBefore = gs.currentLevel;
      const blocked = gs.player.checkTileInteraction(exit.c, exit.r);
      if (!blocked) record('exit was passable with the main boss still alive (boss skip)');
      else console.log('  exit blocked while boss is alive');
      if (gs.currentLevel !== levelBefore) record('touching the exit advanced the level despite a living boss');

      // Kill the boss, then the exit must open
      gs.currentBoss.takeDamage(1e9);
      gs.currentBoss = null;
      const openNow = gs.player.checkTileInteraction(exit.c, exit.r);
      if (openNow) record('exit still blocked after the boss died');
      else console.log('  exit opens once the boss is dead');
    }
  }
  gs.clearLevelTransition();
}

// --- 14. Dying during a level transition does not freeze the game ---
console.log('[14] Death during level transition is handled...');
{
  console.log = noop;
  gs.gameOver = false;
  gs.currentLevel = 2;
  gs.initLevel();
  gs.isLevelCompleting = false;
  gs.levelComplete();            // shows the tally and waits for the player
  const waiting = gs.awaitingContinue;
  gs.showGameOverScreen();       // player dies in the same window
  const advanced = gs.continueToNextLevel();   // a stray Enter on the Game Over screen
  console.log = origLog;

  if (!waiting) record('levelComplete did not wait for the player to continue');
  if (gs.awaitingContinue) record('game over did not cancel the pending level transition');
  else console.log('  pending transition cancelled on death');
  if (advanced) record('continue started a level over a dead player');
  gs.clearLevelTransition();
  gs.gameOver = false;
}

// --- 14b. The death beat plays out and still reaches Game Over ---
//
// The player's death animation needs the loop to keep running for a beat after
// health hits zero. Both gameLoop() and the renderer bail on `gameOver`, so
// arming that flag early would freeze on a blank screen and never show the
// overlay -- an unrecoverable hang. This drives the real loop guard.
console.log('[14b] Death animation plays, then Game Over appears...');
{
  console.log = noop;
  gs.currentLevel = 1; gs.gameOver = false; gs.isLevelCompleting = false;
  gs.initLevel();
  gs.player.health = 0;

  let frames = 0, deathFrames = 0, overlayAt = -1;
  for (let t = 1; t <= PLAYER_DEATH_BEAT + 120; t++) {
    if (!gs.gameRunning || gs.gameOver || gs.isLevelCompleting) break;  // gameLoop()'s guard
    gs.update();
    frames++;
    if (gs.player.animation === 'death') deathFrames++;
    if (gs.gameOver && overlayAt < 0) overlayAt = t;
  }
  console.log = origLog;

  if (frames < 10) record(`loop stopped ${frames} frames after death (death animation never plays)`);
  else console.log(`  loop ran ${frames} frames after death`);
  if (!gs.gameOver) record('Game Over never appeared after the death beat (game would hang)');
  else console.log(`  Game Over shown at frame ${overlayAt} (beat is ${PLAYER_DEATH_BEAT})`);
  if (gs.player.isMoving) record('player kept moving while dead');

  gs.gameOver = false;
  gs.playerDeathTimer = -1;
}

// --- 15. Melee stays available and addressable ---
console.log('[15] Melee slot stays addressable...');
{
  console.log = noop;
  gs.currentLevel = 1; gs.gameOver = false; gs.initLevel();
  console.log = origLog;
  const p2 = gs.player;

  // Key 1 is the knife, and the player always owns it.
  const slot = p2.weapons.findIndex(w => w.name === 'Knife');
  if (slot === -1) record('melee slot is unreachable by name (key 1 dead)');
  else if (!p2.weapons[slot].owned) record('the player does not start with the knife');
  else console.log(`  melee slot resolvable at index ${slot} (${p2.weapons[slot].name})`);

  // Everything past the pistol has to be found.
  const found = p2.weapons.filter(w => w.owned).map(w => w.name).sort().join(', ');
  if (found !== 'Knife, Pistol') record(`player starts with ${found}, expected Knife, Pistol`);

  // Auto-switch must still find a melee fallback with every gun empty
  p2.weapons.forEach(w => { if (w.ammo !== Infinity) w.ammo = 0; });
  p2.autoSwitchWeapon();
  const cur = p2.getCurrentWeapon();
  if (!cur || (cur.ammo !== Infinity && cur.ammo <= 0)) record('autoSwitchWeapon left the player on an empty weapon');
  else console.log(`  auto-switch fell back to ${cur.name}`);
}

// --- 16. Long soak: no unbounded growth, no exceptions ---
console.log('[16] Soak: 3000 frames on one level...');
{
  console.log = noop;
  gs.gameOver = false; gs.currentLevel = 7; gs.initLevel();
  console.log = origLog;
  mouse.down = true; keys.a = true;
  gs.player.collectAllGuns();
  let peakB = 0, peakE = 0, peakX = 0, peakFx = 0;
  try {
    for (let f = 0; f < 3000; f++) {
      gs.frameCount++;
      gs.update();
      gs.player.health = gs.player.maxHealth;
      gs.gameOver = false;
      peakB = Math.max(peakB, gs.bullets.length);
      peakE = Math.max(peakE, gs.enemies.length);
      peakX = Math.max(peakX, gs.explosions.length);
      peakFx = Math.max(peakFx, gs.temporaryVisualEffects.length);
    }
    console.log(`  survived 3000 frames; peaks bullets:${peakB} enemies:${peakE} explosions:${peakX} effects:${peakFx}`);
    if (peakFx > 5000) record(`temporaryVisualEffects grew to ${peakFx}`);
    if (peakX > 2000) record(`explosions grew to ${peakX}`);
  } catch (e) {
    record(`soak threw: ${e.message}`);
  }
  mouse.down = false; keys.a = false;
  gs.clearLevelTransition();
}


// --- 17. Pickups happen on contact, not from an adjacent tile ---
console.log('[17] Items are collected only when stood on...');
{
  console.log = noop; gs.startGame(); gs.gameOver = false; console.log = origLog;
  const p3 = gs.player;

  // Carve a clean corridor around the player and drop a key two tiles away
  const px = Math.floor(p3.x / 40), py = Math.floor(p3.y / 40);
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) gs.gameMap[py + dy][px + dx] = 0;

  p3.keysCollected = { red: false, yellow: false, blue: false };
  gs.gameMap[py][px + 2] = 6; // TILE_KEY_RED, two tiles to the right

  keys.d = true;
  p3.update();          // one step right - still not on the key tile
  keys.d = false;
  if (p3.keysCollected.red) record('key collected from two tiles away (speculative probe still mutating)');
  else console.log('  key not collected from a distance');

  // Now stand on it
  p3.x = (px + 2) * 40 + 20;
  p3.interactWithOccupiedTiles();
  if (!p3.keysCollected.red) record('key NOT collected while standing on it (pickups broken)');
  else console.log('  key collected when stood on');
  if (gs.gameMap[py][px + 2] !== 0) record('key tile not cleared after pickup');
}

// --- 18. Doors: blocked without the key, open with it ---
console.log('[18] Doors respect keys...');
{
  const p4 = gs.player;
  const px = Math.floor(p4.x / 40), py = Math.floor(p4.y / 40);
  gs.gameMap[py][px + 1] = 4; // TILE_DOOR_BLUE

  p4.keysCollected.blue = false;
  if (!p4.isTileBlocking(px + 1, py)) record('blue door was passable without the blue key');
  else console.log('  locked door blocks movement');

  registerDoors(gs.gameMap);
  p4.keysCollected.blue = true;
  if (!p4.isTileBlocking(px + 1, py)) record('blue door opened before it was touched');
  else console.log('  a door has to be touched to unlock, key or no key');

  // Pushing into it with the key unlocks it, and it slides open.
  p4.x = px * 40 + 20; p4.y = py * 40 + 20;
  keys.d = true;
  for (let i = 0; i < DOORS.OPEN_FRAMES + 8; i++) { p4.update(); updateDoors(gs); }
  keys.d = false;
  const door = doorAtTile(px + 1, py);
  if (!door || !door.unlocked) record('pushing into the door with the key did not unlock it');
  else console.log('  touching it with the key unlocks it');
  if (p4.isTileBlocking(px + 1, py)) record('the unlocked door did not slide open');
  else console.log('  it slides open');
  if (gs.gameMap[py][px + 1] !== 4) record('the door tile was destroyed instead of opened');
  else console.log('  the door is still a door');
}

// --- 19. Health pack tile and weapon tiles still pick up ---
console.log('[19] Map-tile weapon and health pickups work...');
{
  const p5 = gs.player;
  const px = Math.floor(p5.x / 40), py = Math.floor(p5.y / 40);
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) gs.gameMap[py + dy][px + dx] = 0;

  p5.health = 10;
  gs.gameMap[py][px] = 13; // TILE_HEALTH_PACK under the player
  p5.interactWithOccupiedTiles();
  if (p5.health <= 10) record('health pack tile did not heal');
  else console.log(`  health pack healed to ${p5.health}`);

  // Every weapon tile grants its weapon.
  for (const [tile, name] of [[9, 'Shotgun'], [10, 'Rifle'], [11, 'Rocket Launcher'], [12, 'BFG'], [15, 'Plasma Gun']]) {
    const w = p5.weapons.find(x => x.name === name);
    w.owned = false; w.ammo = 0;
    gs.gameMap[py][px] = tile;
    p5.interactWithOccupiedTiles();
    if (!w.owned) record(`${name} tile (${tile}) did not grant the weapon`);
    else if (typeof w.damage !== 'number') record(`${name} damage is ${typeof w.damage} after pickup`);
  }
  console.log('  every weapon tile grants its weapon');
}

// ---------------------------------------------------------------- Summary
console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All checks passed.');
} else {
  console.log(`${failures.length} FAILURE(S):`);
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(failures.length === 0 ? 0 : 1);
