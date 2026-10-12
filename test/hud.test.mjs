// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Status bar. Run with: npm test
 *
 * js/hud.js, against a stub page:
 *
 *   1. The face's health tiers are Doom's (ST_calcPainOffset): 80% and up is
 *      the healthy face, under 20% the last, and a soulsphere's 200 counts as
 *      100.
 *   2. A hit turns the face towards its source on screen -- left, right, or
 *      full-face for one from above or below, or from nowhere.
 *   3. chooseFace() keeps Doom's priorities: dead, grin, ouch, hurt, rampage,
 *      god, idle; and each expression lets go when its time is up.
 *   4. The numbers: AMMO is the pool of the weapon in hand and a dash for the
 *      knife; HEALTH and ARMOR round up; the armour's colour follows its
 *      class.
 *   5. StatusBar reads a player into the page: every readout, the ARMS slots,
 *      the ammo table, the keys -- and turns changes into faces: a hit from
 *      the left looks left, a big one is an ouch, a new gun is a grin, a held
 *      trigger is the rampage face, and a new game starts clean.
 */

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

/** A class list that remembers, so classes can be read back. */
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

/** An element with the parts of the DOM the status bar uses. */
function makeElement(id, dataset = {}) {
    const children = {};
    const el = {
        id, dataset: { ...dataset }, textContent: '', innerHTML: '',
        classList: makeClassList(),
        pulses: [],
        animate(frames) { this.pulses.push(frames); return {}; },
        querySelector(selector) {
            if (!children[selector]) children[selector] = makeElement(`${id} ${selector}`);
            return children[selector];
        },
    };
    return el;
}

const WEAPON_NAMES = ['Knife', 'Pistol', 'Shotgun', 'Rifle', 'Rocket Launcher', 'Plasma Gun', 'BFG'];

function makePage() {
    const elements = new Map();
    const slots = WEAPON_NAMES.map((name, i) => makeElement(`slot${i + 1}`, { weaponName: name }));
    return {
        elements,
        slots,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeElement(id));
            return elements.get(id);
        },
        querySelectorAll: (selector) => (selector === '[data-weapon-name]' ? slots : []),
    };
}

globalThis.window = globalThis;
globalThis.gameState = { score: 0 };

const {
    healthTier, hurtSide, chooseFace, ammoReadout, percentText, armorKind,
    StatusBar, FACE_TIMING, FACE_SVG, MUCH_PAIN,
} = await import('../js/hud.js');
const { AMMO_TYPES } = await import('../js/constants.js');

// ------------------------------------------------------------- fake players

/**
 * Just enough of a Player for the bar: shared ammo pools behind the weapons,
 * as Player.initializeWeapons() wires them.
 */
function makePlayer() {
    const ammo = { bullets: 50, shells: 0, rockets: 0, cells: 0 };
    const ammoMax = { bullets: 200, shells: 50, rockets: 50, cells: 300 };
    const types = [null, 'bullets', 'shells', 'bullets', 'rockets', 'cells', 'cells'];
    const weapons = WEAPON_NAMES.map((name, i) => {
        const weapon = { name, owned: i < 2, ammoType: types[i] };
        if (types[i]) {
            Object.defineProperty(weapon, 'ammo', { get: () => ammo[types[i]], enumerable: true });
        } else {
            weapon.ammo = Infinity;
        }
        return weapon;
    });
    return {
        x: 500, y: 500,
        health: 100, maxHealth: 100,
        armor: 0, armorClass: 0,
        ammo, ammoMax, weapons,
        currentWeaponIndex: 1,
        keysCollected: { red: false, yellow: false, blue: false },
        godMode: false,
        refireCount: 0,
        hitSerial: 0,
        hitFrom: null,
        isInvulnerable() { return this.godMode; },
        /** As Player.takeDamage records a hit, without the armour sums */
        hit(amount, from) {
            this.hitSerial++;
            this.hitFrom = from;
            this.health = Math.max(0, this.health - amount);
        },
    };
}

// =============================================================================
// 1. HEALTH TIERS
// =============================================================================

console.log('[tiers]');
{
    const cases = [[100, 0], [80, 0], [79, 1], [60, 1], [59, 2], [40, 2], [39, 3], [20, 3], [19, 4], [1, 4], [0, 4], [200, 0], [79.2, 0]];
    for (const [health, tier] of cases) {
        check(`${health} health is tier ${tier}`, healthTier(health) === tier, String(healthTier(health)));
    }
}

// =============================================================================
// 2. WHICH WAY TO LOOK
// =============================================================================

console.log('[hurt side]');
{
    const me = { x: 100, y: 100 };
    check('a hit from the left looks left', hurtSide(me, { x: 20, y: 110 }) === 'left');
    check('a hit from the right looks right', hurtSide(me, { x: 180, y: 80 }) === 'right');
    check('a hit from above is full-face', hurtSide(me, { x: 110, y: 10 }) === 'front');
    check('a hit from below is full-face', hurtSide(me, { x: 95, y: 200 }) === 'front');
    check('a hit from nowhere is full-face', hurtSide(me, null) === 'front');
    check('a blast on top of him is full-face', hurtSide(me, { x: 100, y: 100 }) === 'front');
}

// =============================================================================
// 3. PRIORITIES
// =============================================================================

console.log('[face priorities]');
{
    const now = 10000;
    const base = { health: 100, god: false, grinUntil: 0, ouchUntil: 0, hurtUntil: 0, hurtSide: 'front', firingSince: null, glance: 'center' };
    const face = (over) => chooseFace({ ...base, ...over }, now);

    check('idle by default, looking where it glances', face({ glance: 'left' }).mood === 'idle' && face({ glance: 'left' }).look === 'left');
    check('god mode glows', face({ god: true }).mood === 'god');
    check('a held trigger beats god mode, after the delay',
        face({ god: true, firingSince: now - FACE_TIMING.RAMPAGE_AFTER_MS }).mood === 'rampage' &&
        face({ firingSince: now - 100 }).mood === 'idle');
    check('a hit beats the rampage, and looks towards it',
        face({ firingSince: 0, hurtUntil: now + 1, hurtSide: 'right' }).mood === 'hurt' &&
        face({ hurtUntil: now + 1, hurtSide: 'right' }).look === 'right');
    check('a hit from in front looks straight out', face({ hurtUntil: now + 1, hurtSide: 'front' }).look === 'center');
    check('an ouch beats a plain hit', face({ hurtUntil: now + 1, ouchUntil: now + 1 }).mood === 'ouch');
    check('a new gun\'s grin beats pain, as in Doom', face({ ouchUntil: now + 1, grinUntil: now + 1 }).mood === 'grin');
    check('death beats everything', face({ health: 0, grinUntil: now + 1, god: true }).mood === 'dead');
    check('an expression lets go when its time is up', face({ hurtUntil: now, grinUntil: now - 1 }).mood === 'idle');
    check('the tier comes with every mood', face({ health: 30, grinUntil: now + 1 }).tier === 3);
}

// =============================================================================
// 4. NUMBERS
// =============================================================================

console.log('[numbers]');
{
    const p = makePlayer();
    check('AMMO is the pool of the weapon in hand', ammoReadout(p.weapons[1]) === 50 && ammoReadout(p.weapons[3]) === 50);
    check('...and nothing for the knife', ammoReadout(p.weapons[0]) === null);
    check('percentages round up', percentText(0.4) === '1' && percentText(99.2) === '100' && percentText(-3) === '0');
    check('no armour is "none"', armorKind({ armor: 0, armorClass: 2 }) === 'none');
    check('class 1 is green, class 2 blue', armorKind({ armor: 5, armorClass: 1 }) === 'green' && armorKind({ armor: 5, armorClass: 2 }) === 'blue');
    check('the face is drawn, with every mood\'s mouth', ['idle', 'grit', 'ouch', 'grin', 'smirk', 'dead'].every(m => FACE_SVG.includes(`mouth-${m}`)));
}

// =============================================================================
// 5. THE BAR
// =============================================================================

console.log('[status bar]');
{
    const page = makePage();
    const bar = new StatusBar(page);
    const el = (id) => page.getElementById(id);
    const face = el('faceDisplay');
    let now = 1000;

    const p = makePlayer();
    bar.update(p, now);
    check('the face artwork goes in', face.innerHTML.includes('<svg'));
    check('AMMO, HEALTH and ARMOR show', el('ammoDisplay').textContent === '50' &&
        el('healthDisplay').textContent === '100' && el('armorDisplay').textContent === '0');
    check('a new game starts on the plain face', face.dataset.mood === 'idle' && face.dataset.tier === '0');
    check('and with no flash for "gaining" 100 health', el('healthDisplay').pulses.length === 0);
    check('the knife and pistol are owned, the pistol in hand',
        page.slots[0].classList.contains('owned') && page.slots[1].classList.contains('current') &&
        !page.slots[2].classList.contains('owned'));
    check('the ammo table lists every pool',
        Object.keys(AMMO_TYPES).every(t => el(`ammoMax-${t}`).textContent === String(p.ammoMax[t])) &&
        el('ammoCurrent-bullets').textContent === '50');
    check('...picking out the one in use', el('ammoRow-bullets').classList.contains('active') &&
        !el('ammoRow-shells').classList.contains('active'));
    check('a slot carries its pool\'s count only once owned',
        page.slots[1].querySelector('.arms-ammo').textContent === '50' &&
        page.slots[3].querySelector('.arms-ammo').textContent === '');

    // The knife: a dash
    p.currentWeaponIndex = 0;
    bar.update(p, now);
    check('the knife shows a dash', el('ammoDisplay').textContent === '--' && el('ammoDisplayContainer').classList.contains('none'));
    p.currentWeaponIndex = 1;

    // A hit from the left
    now += 100;
    p.hit(10, { x: p.x - 300, y: p.y });
    bar.update(p, now);
    check('a hit from the left looks left', face.dataset.mood === 'hurt' && face.dataset.look === 'left',
        `${face.dataset.mood} ${face.dataset.look}`);
    check('the health flashes down', el('healthDisplay').pulses.length === 1);

    // The second refresh of the same hit (armour first, then health) keeps the side
    p.health -= 2;
    bar.update(p, now + 10);
    check('a second refresh of one hit keeps its side', face.dataset.look === 'left');

    now += FACE_TIMING.HURT_MS + 50;
    bar.update(p, now);
    check('the hurt look lets go', face.dataset.mood === 'idle');

    // A big hit
    p.hit(MUCH_PAIN + 5, { x: p.x + 300, y: p.y });
    bar.update(p, now);
    check(`more than ${MUCH_PAIN} in one hit is an ouch`, face.dataset.mood === 'ouch');
    check('...and the tier follows the health', face.dataset.tier === String(healthTier(p.health)));
    now += FACE_TIMING.OUCH_MS + 50;

    // Armour soaking the whole hit still hurts
    p.hit(0, { x: p.x + 300, y: p.y });
    bar.update(p, now);
    check('a hit the armour soaks still shows', face.dataset.mood === 'hurt' && face.dataset.look === 'right');
    now += FACE_TIMING.HURT_MS + 50;

    // A new weapon
    p.weapons[2].owned = true;
    p.ammo.shells = 8;
    bar.update(p, now);
    check('a new gun is a grin', face.dataset.mood === 'grin');
    check('...its slot lights', page.slots[2].classList.contains('owned'));
    check('...and the shells flash up', el('ammoCurrent-shells').pulses.length === 1);
    now += FACE_TIMING.GRIN_MS + 50;
    bar.update(p, now);

    // Firing: spending ammo never flashes, but picking it up does
    const ammoPulses = el('ammoDisplay').pulses.length;
    p.ammo.bullets -= 1;
    bar.update(p, now);
    check('a shot spent does not flash AMMO', el('ammoDisplay').pulses.length === ammoPulses);
    p.ammo.bullets += 10;
    bar.update(p, now);
    check('ammo picked up does', el('ammoDisplay').pulses.length === ammoPulses + 1);

    // Holding the trigger
    p.refireCount = 1;
    bar.tick(p, now);
    bar.tick(p, now + FACE_TIMING.RAMPAGE_AFTER_MS);
    check('a trigger held two seconds bares the teeth', face.dataset.mood === 'rampage');
    p.refireCount = 0;
    bar.tick(p, now + FACE_TIMING.RAMPAGE_AFTER_MS + 16);
    check('letting go ends it', face.dataset.mood !== 'rampage');
    now += FACE_TIMING.RAMPAGE_AFTER_MS + 100;

    // God mode, armour and keys
    p.godMode = true;
    p.armor = 200;
    p.armorClass = 2;
    p.keysCollected.yellow = true;
    bar.update(p, now);
    check('god mode glows', face.dataset.mood === 'god');
    check('blue armour is blue', el('armorDisplayContainer').classList.contains('armor-blue') &&
        !el('armorDisplayContainer').classList.contains('armor-none') && el('armorDisplay').textContent === '200');
    check('the yellow key lights, the others do not', el('yellowKeyIcon').classList.contains('collected') &&
        !el('redKeyIcon').classList.contains('collected'));
    p.godMode = false;

    // Score
    window.gameState.score = 12450;
    bar.update(p, now);
    check('the score shows with separators', el('scoreDisplay').textContent === '12,450');

    // Low health
    p.health = 20;
    bar.update(p, now);
    check('a quarter health or less throbs', el('healthDisplayContainer').classList.contains('low'));

    // Death
    p.health = 0;
    bar.update(p, now + 5000);
    check('dead is dead', face.dataset.mood === 'dead');

    // A new game: a fresh player owning fewer guns is no grin, and no flash
    const q = makePlayer();
    const healthPulses = el('healthDisplay').pulses.length;
    bar.update(q, now + 6000);
    check('a new player is a clean face', face.dataset.mood === 'idle' && face.dataset.tier === '0');
    check('...with no flash for coming back to 100', el('healthDisplay').pulses.length === healthPulses);

    // Writes are skipped when nothing changed
    el('healthDisplay').textContent = 'untouched';
    bar.update(q, now + 6001);
    check('an unchanged number is not rewritten', el('healthDisplay').textContent === 'untouched');
}

console.log('');
if (failures === 0) {
    console.log('All status bar checks passed.');
    process.exit(0);
} else {
    console.error(`${failures} status bar check(s) FAILED.`);
    process.exit(1);
}
