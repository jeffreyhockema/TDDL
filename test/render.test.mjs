// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Jeff Hockema. See LICENSE and NOTICE.md.

/**
 * Render pipeline smoke test.  Run with: npm test
 *
 * Drives GameController's real rendering path against a recording canvas stub.
 * The lighting maths is covered by lighting.test.mjs; this exists to prove the
 * multi-layer composite in main.js actually executes -- offscreen layers, world
 * transforms, the light mask and the memory pass -- without throwing, and that it
 * genuinely draws the things it is supposed to.
 */

const failures = [];
const check = (name, condition, detail = '') => {
    if (condition) {
        console.log(`  ok    ${name}`);
    } else {
        console.log(`  FAIL  ${name}${detail ? ' -- ' + detail : ''}`);
        failures.push(name);
    }
};

// ---------------------------------------------------------------- canvas stub
/** Records every drawing call so we can assert about what was rendered. */
function makeRecordingCtx(log, tag) {
    const state = { globalCompositeOperation: 'source-over', globalAlpha: 1 };
    const record = (op) => (...args) => { log.push({ tag, op, args }); };
    return {
        get canvas() { return { width: 1200, height: 800 }; },
        save: record('save'),
        restore: record('restore'),
        translate: record('translate'),
        scale: record('scale'),
        setTransform: record('setTransform'),
        clearRect: record('clearRect'),
        fillRect: record('fillRect'),
        strokeRect: record('strokeRect'),
        fillText: record('fillText'),
        beginPath: record('beginPath'),
        closePath: record('closePath'),
        moveTo: record('moveTo'),
        lineTo: record('lineTo'),
        arc: record('arc'),
        ellipse: record('ellipse'),
        quadraticCurveTo: record('quadraticCurveTo'),
        rect: record('rect'),
        clip: record('clip'),
        fill: record('fill'),
        stroke: record('stroke'),
        rotate: record('rotate'),
        drawImage: record('drawImage'),
        createRadialGradient: () => ({ addColorStop() {} }),
        createConicGradient: (...a) => { log.push({ tag, op: 'conicGradient', args: a }); return { addColorStop() {} }; },
        createLinearGradient: (...a) => {
            log.push({ tag, op: 'linearGradient', args: a });
            return { addColorStop(...st) { log.push({ tag, op: 'gradientStop', args: st }); } };
        },
        measureText: () => ({ width: 10 }),
        set fillStyle(v) { state.fillStyle = v; log.push({ tag, op: 'fillStyle', args: [v] }); },
        get fillStyle() { return state.fillStyle; },
        set strokeStyle(v) { state.strokeStyle = v; },
        get strokeStyle() { return state.strokeStyle; },
        set globalCompositeOperation(v) { state.globalCompositeOperation = v; log.push({ tag, op: 'gco', args: [v] }); },
        get globalCompositeOperation() { return state.globalCompositeOperation; },
        set globalAlpha(v) { state.globalAlpha = v; log.push({ tag, op: 'alpha', args: [v] }); },
        get globalAlpha() { return state.globalAlpha; },
        set font(v) { state.font = v; },
        get font() { return state.font; },
        set lineWidth(v) { state.lineWidth = v; },
        get lineWidth() { return state.lineWidth; },
        set textAlign(v) { state.textAlign = v; },
        get textAlign() { return state.textAlign; },
        set textBaseline(v) { state.textBaseline = v; },
        get textBaseline() { return state.textBaseline; },
        set shadowColor(v) { state.shadowColor = v; },
        set shadowBlur(v) { state.shadowBlur = v; },
        set shadowOffsetX(v) { state.shadowOffsetX = v; },
        set shadowOffsetY(v) { state.shadowOffsetY = v; },
        set imageSmoothingEnabled(v) { state.imageSmoothingEnabled = v; },
        get imageSmoothingEnabled() { return state.imageSmoothingEnabled; },
    };
}

const drawLog = [];
let offscreenCount = 0;

const noop = () => {};
function makeElement(id) {
    return {
        id, style: {}, dataset: {}, textContent: '', innerHTML: '',
        width: 1200, height: 800, complete: true, naturalHeight: 64,
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        addEventListener: noop, removeEventListener: noop,
        // The status bar is a strip along the bottom, not another 1200x800
        // box: the canvas is sized to the container less the bar, and a bar as
        // tall as the container left a canvas one pixel high, whose handful of
        // visible tiles made the geometry counts below a coin toss.
        getBoundingClientRect: () => (id === 'uiContainer'
            ? { left: 0, top: 700, width: 1200, height: 100 }
            : { left: 0, top: 0, width: 1200, height: 800 }),
        getContext: () => makeRecordingCtx(drawLog, id),
        querySelector: () => makeElement('child'),
        querySelectorAll: () => [],
    };
}

const elements = new Map();
globalThis.window = globalThis;
globalThis.document = {
    getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    },
    querySelector: () => makeElement('q'),
    querySelectorAll: () => [],
    createElement: () => {
        // Offscreen layers, in the order ensureRenderLayers creates them
        const names = ['lit', 'mask', 'scratch', 'mem', 'sense', 'senseMask',
                       'stage', 'seen', 'minimap', 'sightMask'];
        const tag = names[offscreenCount] || `extra${offscreenCount}`;
        offscreenCount++;
        const el = makeElement(tag);
        el.getContext = () => makeRecordingCtx(drawLog, tag);
        return el;
    },
    addEventListener: noop, removeEventListener: noop, hidden: false,
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.AbortController = class { constructor() { this.signal = {}; } abort() {} };

const origLog = console.log, origWarn = console.warn;
console.log = noop; console.warn = noop;

const { GameState } = await import('../js/game-state.js');
const { GameController } = await import('../js/main.js');
const { TILE_SIZE } = await import('../js/constants.js');
const { resetLighting, isTileExplored, isTileLit, LIGHTING, isOpaqueTile,
        updateLighting, getVisionPolygons } = await import('../js/lighting.js');
const { MAP_COLS, MAP_ROWS, WALL_STYLES } = await import('../js/constants.js');
const { registerSectors } = await import('../js/sectors.js');

console.log = origLog; console.warn = origWarn;

console.log('\n=== render pipeline ===\n');

// ---------------------------------------------------------------- build a game
console.log = noop;
const controller = new GameController();
globalThis.gameController = controller;
const gs = controller.gameState;
gs.selectedDifficulty = 'medium';
gs.startGame();
console.log = origLog;

check('controller constructed with a canvas context', !!controller.ctx);
check('game produced a map', !!gs.gameMap);
check('game produced a player', !!gs.player);

// ---------------------------------------------------------------- render frames
{
    let threw = null;
    console.log = noop;
    try {
        // Off the pixel grid on purpose. The player moves freely, so the camera
        // almost never sits on a whole pixel, and that is the case where unsnapped
        // tile rectangles leave seams -- on a whole-pixel camera the bug is
        // invisible and every assertion about it passes vacuously.
        gs.player.x += 0.37;
        gs.player.y -= 0.61;
        for (let i = 0; i < 30; i++) {
            gs.player.angle = (i / 30) * Math.PI * 2;   // sweep the flashlight
            drawLog.length = 0;
            controller.renderGame();
        }
    } catch (e) {
        threw = e;
    }
    console.log = origLog;

    check('renderGame runs without throwing', threw === null,
        threw ? `${threw.constructor.name}: ${threw.message}` : '');
}

// ---------------------------------------------------------------- assertions
{
    const ops = drawLog;
    const tags = new Set(ops.map(o => o.tag));

    check('an offscreen lit layer was created', tags.has('lit'));
    check('an offscreen light mask was created', tags.has('mask'));
    check('an offscreen memory layer was created', tags.has('mem'));
    check('a persistent world-space seen surface was created', tags.has('seen'));

    // The mask must be composited into the lit layer, and the lit layer onto screen
    const litDrawImage = ops.some(o => o.tag === 'lit' && o.op === 'drawImage');
    const screenDrawImage = ops.some(o => o.tag === 'gameCanvas' && o.op === 'drawImage');
    check('light mask is composited into the lit layer', litDrawImage);
    check('lit layer is composited onto the screen', screenDrawImage);

    const usedDestinationIn = ops.some(o => o.tag === 'lit' && o.op === 'gco' && o.args[0] === 'destination-in');
    check('lit layer is clipped by the mask (destination-in)', usedDestinationIn);

    const usedLighter = ops.some(o => o.tag === 'mask' && o.op === 'gco' && o.args[0] === 'lighter');
    check('lights accumulate additively on the mask (lighter)', usedLighter);

    // The mask should describe real polygons, not just a circle
    const maskLineTos = ops.filter(o => o.tag === 'stage' && o.op === 'lineTo').length;
    check('shadow polygons are traced into the light layer', maskLineTos > 50,
        `lineTo count = ${maskLineTos}`);

    // Each light is cast from a disc of origins, not a point, and their fans are
    // SUMMED at an equal share each so a corner fades across a penumbra. Painting
    // them over one another instead would light anything any origin could see --
    // a point light again, only fatter.
    const originFills = ops.filter(o => o.tag === 'stage' && o.op === 'fill').length;
    const sharedAlpha = ops.some(o => o.tag === 'stage' && o.op === 'alpha' &&
        o.args[0] > 0 && o.args[0] < 1);
    const summed = ops.some(o => o.tag === 'stage' && o.op === 'gco' && o.args[0] === 'lighter');
    check('each light is cast from several origins', originFills >= LIGHTING.LIGHT_ORIGINS,
        `stage fill count = ${originFills}, origins = ${LIGHTING.LIGHT_ORIGINS}`);
    check('origins are summed at an equal share, not painted over each other',
        summed && sharedAlpha);

    // Both passes must draw geometry onto their own layers
    const litFills = ops.filter(o => o.tag === 'lit' && o.op === 'fillRect').length;
    const memFills = ops.filter(o => o.tag === 'mem' && o.op === 'fillRect').length;
    check('lit pass draws world geometry', litFills > 50, `fillRect count = ${litFills}`);
    check('memory pass draws remembered geometry', memFills > 50,
        `fillRect count = ${memFills}`);

    // Memory must be clipped by the persistent seen surface, not by tile flags
    const memDrewSeen = ops.some(o => o.tag === 'mem' && o.op === 'drawImage');
    check('memory layer is combined with the seen surface', memDrewSeen);

    // The seen surface accumulates by copying the finished mask into world space
    // Memory must combine with `lighten` (a true maximum), never additively --
    // additive accumulation saturates any lit pixel to fully-explored in ~15 frames,
    // so the revealed area keeps growing while the player stands still.
    const seenMaxes = ops.some(o => o.tag === 'seen' && o.op === 'gco' && o.args[0] === 'lighten');
    const seenAdds = ops.some(o => o.tag === 'seen' && o.op === 'gco' && o.args[0] === 'lighter');
    const seenTakesMask = ops.some(o => o.tag === 'seen' && o.op === 'drawImage');
    check('seen surface records the maximum, not a running sum', seenMaxes && !seenAdds);
    check('seen surface records this frame from the mask', seenTakesMask);

    // The mask has to actually be painted into the scratch buffer before that
    // buffer is stamped. A malformed gain once left the loop bound NaN, so the
    // scratch stayed black and nothing was ever remembered -- while every other
    // assertion here still passed, because the stamp itself still happened.
    const scratchTakesMask = ops.filter(o => o.tag === 'scratch' && o.op === 'drawImage').length;
    check('the mask is written into the seen buffer', scratchTakesMask >= LIGHTING.MEMORY_GAIN,
        `drawImage count = ${scratchTakesMask}, gain = ${LIGHTING.MEMORY_GAIN}`);

    // ...and the memory layer modulates by that grey record rather than masking on
    // alpha, which is what makes the maximum representable in the first place
    const memMultiplies = ops.some(o => o.tag === 'mem' && o.op === 'gco' && o.args[0] === 'multiply');
    check('memory is modulated by the seen record', memMultiplies);

    // ------------------------------------------------------------- wall faces
    // Walls are lit at the face that fronts walkable ground, measured the same way
    // a floor tile is. They are painted straight onto the source's own layer as a
    // wipe and a shaded fill per span -- no separate surface, no reading the fan
    // back, no per-tile blits.
    check('no separate wall or face surface is created',
        !tags.has('wall') && !tags.has('face'));

    const wallGradients = ops.filter(o => o.tag === 'scratch' && o.op === 'linearGradient').length;
    check('wall spans are shaded by a gradient along the face', wallGradients > 0,
        `linear gradient count = ${wallGradients}`);

    // Sampled along the face rather than flat, which is what lets a pillar throw its
    // shadow across a wall instead of the wall switching on and off as a unit
    const stopsPerGradient = ops.filter(o => o.tag === 'scratch' && o.op === 'gradientStop').length /
        Math.max(1, wallGradients);
    check('faces are sampled along their length, not flat',
        stopsPerGradient > LIGHTING.WALL_FACE_SAMPLES_PER_TILE,
        `${stopsPerGradient.toFixed(1)} stops per span`);

    // Every span is wiped before it is filled: the floor pass blurs a few pixels
    // past the wall's near face and the two would otherwise sum and saturate
    const wallClears = ops.filter(o => o.tag === 'scratch' && o.op === 'clearRect' &&
        o.args[2] > 0 && o.args[2] < 1200);
    // These are screen rectangles, so a tile is TILE_SIZE scaled by the camera.
    const deviceTile = TILE_SIZE * controller.zoomLevel;
    const wholeTiles = (span) => Math.abs(span / deviceTile - Math.round(span / deviceTile)) < 1e-6;
    const raggedClears = wallClears.filter(o => !wholeTiles(o.args[2]) || !wholeTiles(o.args[3])).length;
    check('wall spans are cleared before being painted (no double count)',
        wallClears.length > 0, `wall clearRect count = ${wallClears.length}`);
    check('every wall clear covers a whole number of tiles', raggedClears === 0,
        `${raggedClears} of ${wallClears.length} clears are not tile-aligned`);

    // The spans must land on whole device pixels. The camera sits at a fractional
    // position, so an unsnapped tile edge falls mid-pixel; neighbours then each
    // cover part of it and source-over does not add them back to full, leaving a
    // dark seam around every tile.
    const whole = (v) => Number.isInteger(v);
    const wallFills = ops.filter(o => o.tag === 'scratch' && o.op === 'fillRect' &&
        o.args[2] > 0 && o.args[2] < 1200);
    const fractional = wallFills.filter(o => !(whole(o.args[0]) && whole(o.args[1]) &&
        whole(o.args[2]) && whole(o.args[3]))).length;
    check('wall spans are drawn on whole pixels (no seams)',
        wallFills.length > 0 && fractional === 0, `fractional spans = ${fractional}`);

    // One span per run of wall, so the count tracks the number of WALLS rather than
    // the number of tiles. An order of magnitude more would mean runs had stopped
    // merging, or that unlit walls had started being collected again.
    check('the wall pass stays proportionate', wallGradients < 400,
        `span count = ${wallGradients}`);

    // Each source is resolved on its own layer, then added to the mask
    const maskAdds = ops.filter(o => o.tag === 'mask' && o.op === 'drawImage').length;
    check('each source layer is composited into the mask', maskAdds > 0,
        `drawImage count = ${maskAdds}`);

    // The fan must be traced as real shadow polygons, never an unoccluded disc or
    // sector -- which would light a wall behind a pillar as brightly as one in front
    const scratchArcs = ops.filter(o => o.tag === 'scratch' && o.op === 'arc').length;
    check('coverage comes from the shadow fan, not an unoccluded shape',
        scratchArcs === 0, `arc count = ${scratchArcs}`);

    // Sources are resolved only over the area they can reach: a source costs a blur,
    // a gradient fill and a composite apiece, and over the whole canvas the player's
    // three-tile glow would cost as much as one covering the screen.
    const fanBlits = ops.filter(o => o.tag === 'scratch' && o.op === 'drawImage' &&
        o.args.length === 9);
    const wholeSurface = fanBlits.filter(o => o.args[3] >= 1200 && o.args[4] >= 800).length;
    check('sources are resolved only over the area they can reach',
        fanBlits.length > 0 && wholeSurface < fanBlits.length,
        `${wholeSurface} of ${fanBlits.length} fans cover the whole canvas`);

    // The beam's angular falloff is a conic gradient multiplied in with
    // destination-in, not a stack of discrete fans (which visibly stairstepped).
    const usedConic = ops.some(o => o.tag === 'scratch' && o.op === 'conicGradient');
    const scratchDestIn = ops.some(o => o.tag === 'scratch' && o.op === 'gco' && o.args[0] === 'destination-in');
    check('the beam rim fade uses a conic gradient', usedConic);
    check('the rim fade is multiplied into the light layer', scratchDestIn);

    const memToScreen = ops.filter(o => o.tag === 'gameCanvas' && o.op === 'drawImage').length;
    check('memory and lit layers are both composited to screen', memToScreen >= 2,
        `drawImage count = ${memToScreen}`);

    // ---------------------------------------------------------- peripheral vision
    check('an offscreen sense layer was created', tags.has('sense'));
    check('a separate vision mask was created', tags.has('senseMask'));

    // The vision arc must be resolved by the same mask builder the light uses --
    // it is occluded by the same geometry, and anything the two did differently
    // would show up as a seam where the arc crosses the beam's rim.
    const senseMaskAdds = ops.filter(o => o.tag === 'senseMask' && o.op === 'drawImage').length;
    const senseMaskLighter = ops.some(o => o.tag === 'senseMask' && o.op === 'gco' &&
        o.args[0] === 'lighter');
    check('the vision mask is built by the shared mask builder',
        senseMaskAdds > 0 && senseMaskLighter, `drawImage count = ${senseMaskAdds}`);

    // The sense layer draws the world, then keeps only what the arc covers
    const senseFills = ops.filter(o => o.tag === 'sense' && o.op === 'fillRect').length;
    const senseClipped = ops.some(o => o.tag === 'sense' && o.op === 'gco' &&
        o.args[0] === 'destination-in');
    check('the sense pass draws world geometry', senseFills > 50,
        `fillRect count = ${senseFills}`);
    check('the sense pass is clipped by the vision mask', senseClipped);

    // ...and is then drained of colour, which is what keeps "sensed" from reading
    // as "lit". Colour is the thing you do not get without light.
    const senseTinted = ops.some(o => o.tag === 'sense' && o.op === 'gco' &&
        o.args[0] === 'source-atop');
    check('sensed shapes are drained of colour (source-atop wash)', senseTinted);

    // The wash must not brighten anything -- it is a tint, not a second light
    const senseAdds = ops.filter(o => o.tag === 'sense' && o.op === 'gco' &&
        o.args[0] === 'lighter').length;
    check('the wash does not brighten the layer', senseAdds === 0);

    const screenBlits = ops.filter(o => o.tag === 'gameCanvas' && o.op === 'drawImage');
    check('the sense layer reaches the screen', screenBlits.length >= 3,
        `screen drawImage count = ${screenBlits.length}`);
}

// ---------------------------------------------------------------- wall face runs
{
    // The wall pass costs one canvas call per entry, three times over, and was
    // measured at four fifths of the frame. faceRuns() collapses adjacent tiles
    // that share a face direction into one span each -- which is only safe if it
    // is an exact regrouping, so that is what is checked here rather than the
    // speedup: every face must survive, exactly once, and a tile listed twice must
    // still END on the same face, because the extrusion is last-wins.
    const key = (c, r, fx, fy) => `${c},${r},${fx},${fy}`;

    const expand = (runs) => {
        const out = [];
        for (let n = 0; n < runs.length; n += 6) {
            const c0 = runs[n], r0 = runs[n + 1], c1 = runs[n + 2], r1 = runs[n + 3];
            for (let r = r0; r <= r1; r++) {
                for (let c = c0; c <= c1; c++) out.push(key(c, r, runs[n + 4], runs[n + 5]));
            }
        }
        return out;
    };

    const listed = (faces) => {
        const out = [];
        for (let n = 0; n < faces.length; n += 4) {
            out.push(key(faces[n], faces[n + 1], faces[n + 2], faces[n + 3]));
        }
        return out;
    };

    // A hand-built list holding every shape the merge has to cope with
    const faces = [];
    for (let c = 5; c <= 14; c++) faces.push(c, 3, 0, 1);        // ten in a row
    for (let r = 8; r <= 12; r++) faces.push(20, r, 1, 0);       // five in a column
    faces.push(5, 20, 0, 1, 7, 20, 0, 1);                        // a row with a gap
    faces.push(30, 30, 0, -1, 30, 30, 0, 1, 30, 30, -1, 0, 30, 30, 1, 0);  // a pillar
    faces.push(40, 40, -1, -1);                                  // a corner-only tile

    const runs = controller.faceRuns(faces);

    check('merging loses no face and invents none',
        listed(faces).sort().join('|') === expand(runs).sort().join('|'),
        `${faces.length / 4} faces in, ${expand(runs).length} out`);
    check('a straight wall collapses to one span', runs.length / 6 === 9,
        `${runs.length / 6} runs from ${faces.length / 4} faces`);
    check('a gap in a row splits it', expand(runs).filter(k =>
        k === '5,20,0,1' || k === '7,20,0,1').length === 2);
    check('a tile with several faces still ends on the same one',
        expand(runs).filter(k => k.startsWith('30,30,')).pop() === '30,30,1,0' &&
        listed(faces).filter(k => k.startsWith('30,30,')).pop() === '30,30,1,0');

    // Real lists now carry one entry per tile -- a wall is drawn from the single
    // face its source sees best -- so no tile may appear twice in one of them.
    const tileOf = (k) => k.split(',').slice(0, 2).join(',');

    // ...and on the face lists real levels actually produce
    let lossless = true, totalFaces = 0, totalRuns = 0, samples = 0;
    const map = gs.gameMap;
    const bounds = { startRow: 0, endRow: MAP_ROWS, startCol: 0, endCol: MAP_COLS };
    for (let r = 3; r < MAP_ROWS - 3; r += 6) {
        for (let c = 3; c < MAP_COLS - 3; c += 6) {
            if (map[r][c] !== 0) continue;
            gs.player.x = c * TILE_SIZE + TILE_SIZE / 2;
            gs.player.y = r * TILE_SIZE + TILE_SIZE / 2;
            for (const angle of [0, 1.1, 2.4, 4.0]) {
                gs.player.angle = angle;
                console.log = noop;
                const polygons = updateLighting(gs);
                console.log = origLog;
                for (const polygon of [...polygons, ...getVisionPolygons()]) {
                    const real = controller.collectLitWallFaces(polygon, bounds);
                    if (!real.length) continue;
                    const merged = controller.faceRuns(real);
                    if (listed(real).sort().join('|') !== expand(merged).sort().join('|')) {
                        lossless = false;
                    }
                    const tiles = new Set(listed(real).map(tileOf));
                    if (tiles.size !== real.length / 4) lossless = false;
                    totalFaces += real.length / 4;
                    totalRuns += merged.length / 6;
                    samples++;
                }
            }
        }
    }

    check(`merging is lossless across ${samples} real face lists, one entry a tile`,
        lossless);
    check(`the draw count actually collapses ` +
          `(${totalFaces} faces -> ${totalRuns} runs, ` +
          `${(totalFaces / Math.max(1, totalRuns)).toFixed(2)}x fewer calls)`,
        // Furnished rooms hold single-tile props -- a crate, a pillar -- whose
        // four faces can never merge with a neighbour, so the collapse is less
        // dramatic than on bare masonry; it still has to be a real collapse.
        totalRuns > 0 && totalRuns < totalFaces * 0.72);
}

// ---------------------------------------------------------------- pass ordering
{
    // Memory, then what was sensed, then what is lit. Getting this order wrong is
    // not a subtle bug: the grey wash would sit on top of the lit world and drain
    // the colour out of everything the flashlight is pointed at.
    const order = [];
    const layerNames = new Map([
        [controller.memCanvas, 'mem'],
        [controller.senseCanvas, 'sense'],
        [controller.litCanvas, 'lit'],
    ]);

    console.log = noop;
    const realDraw = controller.ctx.drawImage;
    controller.ctx.drawImage = function (image, ...rest) {
        const name = layerNames.get(image);
        if (name) order.push(name);
        return realDraw.call(this, image, ...rest);
    };
    controller.renderGame();
    controller.ctx.drawImage = realDraw;
    console.log = origLog;

    check('the screen is composited memory, then sensed, then lit',
        order.join(' > ') === 'mem > sense > lit', `got "${order.join(' > ')}"`);
}

// ---------------------------------------------------------------- floor seams
{
    // The seams between floor plates are hairlines, and a hairline is only crisp if
    // it lands on a whole device pixel. Drawn inside the world transform they land
    // on whatever fraction of a pixel the camera happens to put them, so their
    // weight splits across two pixels in a ratio that changes as the player walks --
    // the floor grid visibly breathes, and settles somewhere different every time
    // they stop. Measured in a browser before the fix, the contrast of the sharpest
    // seam swung between 7 and 14 across a single pixel of camera movement; after
    // it, between 12 and 14.
    //
    // The property that guarantees it: every seam coordinate is a whole pixel plus
    // a half, which is where a one-pixel stroke covers exactly one pixel.
    const log = [];
    const probe = makeRecordingCtx(log, 'grout');

    console.log = noop;
    // Known open floor, so there is something to lay seams between
    // ...in one style: the generated level's zones are put aside too, or a zone
    // boundary that happens to cross the window would give two grout colours
    const savedMap = gs.gameMap;
    const savedStyles = gs.tileStyles;
    const floor = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
    for (let r = 8; r <= 24; r++) for (let c = 8; c <= 24; c++) floor[r][c] = 0;
    gs.gameMap = floor;
    gs.tileStyles = null;
    const style = { grout: '#333', borderColor: '#333' };
    controller.drawFloorGrout(probe, { startRow: 10, endRow: 20, startCol: 10, endCol: 20 }, style);
    gs.gameMap = savedMap;
    gs.tileStyles = savedStyles;
    console.log = origLog;

    const points = log.filter(o => o.op === 'moveTo' || o.op === 'lineTo');
    check('floor seams are drawn', points.length > 20, `${points.length} seam points`);

    // Each corner of a seam is either a snapped edge (whole pixel) or the half-pixel
    // centre line; both are exactly representable, and neither drifts with the camera
    const offGrid = points.filter(o =>
        !o.args.every(v => Number.isInteger(v) || Number.isInteger(v - 0.5))).length;
    check('every seam lands on a whole pixel', offGrid === 0,
        `${offGrid} of ${points.length} seam points sit mid-pixel`);

    // ...and there is exactly one stroke for the lot, not one per tile. Only
    // the probe's strokes count: the frame rendered above may have stroked a
    // ripple or a spark of its own on another layer.
    const strokes = log.filter(o => o.tag === 'grout' && o.op === 'stroke').length;
    check('the seams are one path, not a stroke per tile', strokes === 1,
        `stroke count = ${strokes}`);

    // Drawn in device space, which is the whole point: a world-space transform is
    // what put them mid-pixel in the first place
    const reset = log.some(o => o.op === 'setTransform' &&
        o.args.join() === [1, 0, 0, 1, 0, 0].join());
    check('seams are drawn in device pixels, not world space', reset);
}

// ---------------------------------------------------------------- minimap
{
    // From a clean slate, so the surface has something to stamp: the panel only
    // ever redraws tiles it has not drawn before.
    console.log = noop;
    gs.showMinimap = true;
    resetLighting();
    drawLog.length = 0;
    controller.renderGame();
    console.log = origLog;

    const ops = drawLog;
    check('a persistent minimap surface was created', ops.some(o => o.tag === 'minimap'));

    // Tiles are stamped one world pixel each, so the surface survives between
    // frames and is blown up on the way out rather than redrawn every frame
    const stamps = ops.filter(o => o.tag === 'minimap' && o.op === 'fillRect' &&
        o.args[2] === 1 && o.args[3] === 1).length;
    check('explored tiles are stamped into it', stamps > 0,
        `1x1 fillRect count = ${stamps}`);

    const blit = ops.find(o => o.tag === 'gameCanvas' && o.op === 'drawImage' &&
        o.args[0] === controller.minimapCanvas);
    check('the surface is blitted to the screen', !!blit);
    check('...scaled up from one pixel a tile',
        !!blit && blit.args[3] > controller.minimapCanvas.width &&
        blit.args[4] > controller.minimapCanvas.height,
        blit ? `drawn at ${blit.args[3]}x${blit.args[4]}` : '');

    const dimmed = ops.some(o => o.tag === 'gameCanvas' && o.op === 'alpha' &&
        o.args[0] > 0 && o.args[0] < 1);
    check('the panel is drawn semi-transparent', dimmed);

    // Only newly revealed tiles are redrawn. A frame that reveals nothing must not
    // restamp the map, or the cached surface is buying nothing.
    console.log = noop;
    drawLog.length = 0;
    controller.renderGame();
    console.log = origLog;
    const restamps = drawLog.filter(o => o.tag === 'minimap' && o.op === 'fillRect').length;
    check('an unchanged minimap is not restamped', restamps < stamps,
        `restamped ${restamps} where the first frame stamped ${stamps}`);

    // Toggling it off must take the whole panel with it
    console.log = noop;
    gs.showMinimap = false;
    drawLog.length = 0;
    controller.renderGame();
    console.log = origLog;
    const hiddenBlits = drawLog.filter(o => o.tag === 'gameCanvas' && o.op === 'drawImage' &&
        o.args[0] === controller.minimapCanvas).length;
    gs.showMinimap = true;
    check('toggling the minimap off stops it drawing', hiddenBlits === 0,
        `${hiddenBlits} blits while hidden`);
}

// ---------------------------------------------------------------- memory behaviour
{
    // Use a hand-built room rather than the generated level: whether a random map
    // happens to offer open floor beyond the glow in some direction is luck, and
    // relying on it made this check quietly skip (or fail) depending on the seed.
    const room = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
    for (let r = 8; r <= 28; r++) for (let c = 8; c <= 40; c++) room[r][c] = 0;

    console.log = noop;
    gs.gameMap = room;
    // The generated level's lamps are still in the state and would now sit inside
    // this bare room, lighting it from nowhere -- world lights are seen all round
    // as of the sightline change, so one behind the player counts. This block is
    // about the player's OWN light, so put them away.
    const savedDecor = gs.decorLights;
    gs.decorLights = [];
    // Same reasoning for the sector lighting: the grid belongs to the generated
    // level, and over this bare room it would light tiles from nowhere. This
    // block is about the player's own beam. Ambient light has its own suite.
    registerSectors(null);
    gs.player.x = 12 * TILE_SIZE + TILE_SIZE / 2;
    gs.player.y = 18 * TILE_SIZE + TILE_SIZE / 2;
    gs.player.angle = 0;                       // face east, down the long axis

    resetLighting();
    controller.renderGame();
    console.log = origLog;

    // Comfortably beyond the glow, well inside the flashlight's reach
    const glowTiles = Math.ceil(LIGHTING.GLOW_RADIUS / TILE_SIZE) + 2;
    const probe = { x: 12 + glowTiles, y: 18 };

    check('probe tile is open floor', room[probe.y][probe.x] === 0);
    check('probe tile is lit by the flashlight', isTileLit(probe.x, probe.y));
    check('probe tile is recorded as explored', isTileExplored(probe.x, probe.y));

    console.log = noop;
    gs.player.angle = Math.PI;                 // turn around
    controller.renderGame();
    console.log = origLog;

    check('probe tile no longer lit after turning away', !isTileLit(probe.x, probe.y));
    check('probe tile still remembered after turning away (dim geometry stays)',
        isTileExplored(probe.x, probe.y));

    gs.decorLights = savedDecor;
    registerSectors(gs.sectorPlan);
}

// ---------------------------------------------------------------- terrain & tileset
// The map the level generator happened to produce may or may not contain lava,
// doors or a key near the player, so the tiles that exercise the new drawing paths
// are planted deliberately. What is being checked is that they draw at all, and
// that their glow lands on the LIT layer and nowhere else.
{
    let threw = null;
    console.log = noop;

    const px = Math.floor(gs.player.x / TILE_SIZE);
    const py = Math.floor(gs.player.y / TILE_SIZE);
    const saved = [];
    const plant = (dx, dy, tile) => {
        const c = px + dx, r = py + dy;
        if (r < 1 || r >= MAP_ROWS - 1 || c < 1 || c >= MAP_COLS - 1) return;
        saved.push({ c, r, tile: gs.gameMap[r][c] });
        gs.gameMap[r][c] = tile;
    };

    // A small lake, a pond, a key of each colour, all three doors and the exit,
    // and one of every prop and floor detail the rooms can be furnished with.
    {
        const { DECOR } = await import('../js/decor.js');
        if (!gs.decor) gs.decor = new Uint8Array(MAP_COLS * MAP_ROWS);
        const ids = Object.values(DECOR).filter(v => v > 0);
        ids.forEach((id, i) => {
            const c = px - 6 + (i % 7), r = py + 5 + Math.floor(i / 7);
            if (r < 1 || r >= MAP_ROWS - 1 || c < 1 || c >= MAP_COLS - 1) return;
            saved.push({ c, r, tile: gs.gameMap[r][c], decor: gs.decor[r * MAP_COLS + c] });
            gs.gameMap[r][c] = id >= 20 ? 19 : 0;   // TILE_PROP for the solid ones
            gs.decor[r * MAP_COLS + c] = id;
        });
    }
    for (let dy = -2; dy <= 0; dy++) for (let dx = 2; dx <= 4; dx++) plant(dx, dy, 16);
    for (let dy = 1; dy <= 2; dy++) for (let dx = -4; dx <= -2; dx++) plant(dx, dy, 18);
    plant(0, -3, 17);
    plant(-1, -3, 6); plant(-2, -3, 7); plant(-3, -3, 8);
    plant(1, 3, 2); plant(2, 3, 3); plant(3, 3, 4);
    plant(-1, 4, 14);

    // Lighting caches its glowing-terrain scan against the map it was built from,
    // and this is the same array with new contents -- so it has to be told.
    resetLighting();

    drawLog.length = 0;
    try {
        controller.renderGame();
    } catch (e) {
        threw = e;
    }
    console.log = origLog;

    check('renderGame draws terrain, doors and keys without throwing', threw === null,
        threw ? `${threw.constructor.name}: ${threw.message}` : '');

    const ops = drawLog;

    // Pools are drawn with clipped, moving blobs. A clip on the lit layer is the
    // signature of the liquid surface -- nothing else in the tile pass clips.
    const litClips = ops.filter(o => o.tag === 'lit' && o.op === 'clip').length;
    check('liquid surfaces are drawn clipped to their tiles', litClips > 0,
        `clip count = ${litClips}`);

    // The bloom over lava, the pool under a key and a door's status lamp are all
    // additive, and all of them belong to the lit pass.
    const litAdds = ops.filter(o => o.tag === 'lit' && o.op === 'gco' &&
        o.args[0] === 'lighter').length;
    check('self-luminous tiles bloom on the lit layer', litAdds > 0,
        `lighter count = ${litAdds}`);

    // ...and none of it may appear on the sense layer. Peripheral vision is a
    // colourless wash; a glow there would be a second torch, and the wash cannot
    // take brightness back out again.
    const senseAdds = ops.filter(o => o.tag === 'sense' && o.op === 'gco' &&
        o.args[0] === 'lighter').length;
    check('nothing self-luminous leaks into the sense pass', senseAdds === 0,
        `lighter count = ${senseAdds}`);

    // Glowing terrain must reach the light list itself, not merely be painted
    // bright: that is what makes a lava lake cast shadows and reveal what is
    // standing beside it.
    const lights = updateLighting(gs).map(polygon => polygon.light);
    const terrainLights = lights.filter(l => String(l.id).startsWith('terrain-'));
    check('glowing terrain contributes real light sources', terrainLights.length > 0,
        `${terrainLights.length} of ${lights.length} lights`);

    // ...but only where the player can see. Terrain glow is flagged gated and
    // its pass is multiplied through the sight stencil before it reaches the
    // mask, so a pool next door cannot light a room the player has not looked
    // into.
    check('terrain lights are gated by sight', terrainLights.every(l => l.gated === true));
    const sightBuilt = ops.some(o => o.tag === 'sightMask' && o.op === 'drawImage');
    check('a sight stencil is built each frame', sightBuilt);

    // The geometry passes skip tiles their mask is zero over -- but never one
    // its soft edge could touch. Every explored tile in view must be marked,
    // along with everything within two tiles of it; and on a level this fresh,
    // most of the viewport must NOT be.
    {
        const bounds = controller.computeVisibleTileBounds(gs.player, controller.canvas.width,
                                                           controller.canvas.height);
        const reach = controller.reachableTiles(bounds, 'memory');
        const cols = bounds.endCol - bounds.startCol;
        let inView = 0, marked = 0, missed = 0;
        for (let r = bounds.startRow; r < bounds.endRow; r++) {
            for (let c = bounds.startCol; c < bounds.endCol; c++) {
                inView++;
                const flag = reach ? reach[(r - bounds.startRow) * cols + (c - bounds.startCol)] : 1;
                if (flag) marked++;
                if (!reach || !isTileExplored(c, r)) continue;
                for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const rr = r + dr, cc = c + dc;
                        if (rr < bounds.startRow || rr >= bounds.endRow ||
                            cc < bounds.startCol || cc >= bounds.endCol) continue;
                        if (!reach[(rr - bounds.startRow) * cols + (cc - bounds.startCol)]) missed++;
                    }
                }
            }
        }
        check('every explored tile and its two-tile margin is drawn by the memory pass',
            reach && missed === 0, `${missed} tiles inside the margin were skipped`);
        check('...while the unexplored bulk of the viewport is not', reach && marked < inView,
            `${marked} of ${inView} tiles drawn`);
    }

    // Masonry is cut to its tile by arithmetic, not by a clip: a save/clip/restore
    // per wall tile was the most expensive thing in the frame.
    {
        const log = [];
        const probe = makeRecordingCtx(log, 'probe');
        controller.drawMasonry(probe, 5, 5, 5 * TILE_SIZE, 5 * TILE_SIZE, WALL_STYLES[0]);
        const clips = log.filter(o => o.op === 'clip' || o.op === 'save').length;
        const strokes = log.filter(o => o.op === 'stroke').length;
        check('masonry is drawn without clipping', strokes > 0 && clips === 0,
            `clip/save count = ${clips}, strokes = ${strokes}`);
    }
    const gatedThroughSight = ops.some((o, i) =>
        o.tag === 'scratch' && o.op === 'gco' && o.args[0] === 'destination-in' &&
        ops.slice(i + 1, i + 3).some(n => n.tag === 'scratch' && n.op === 'drawImage' &&
                                        n.args[0] && n.args[0].id === 'sightMask'));
    check('the glow pass is multiplied through the sight stencil', gatedThroughSight);

    // Doors come in matched pairs across a two-wide corridor, and a pair is one
    // double door: both tiles resolve to the same two-tile span, with the seam
    // and the lock on the boundary between them. A door on its own is one tile.
    {
        const savedMap = gs.gameMap;
        const floor = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(1));
        for (let r = 8; r <= 24; r++) for (let c = 8; c <= 24; c++) floor[r][c] = 0;
        for (let r = 8; r <= 24; r++) floor[r][16] = 1;        // a north-south wall
        floor[15][16] = 2; floor[16][16] = 2;                   // a red door pair in it
        floor[20][16] = 3;                                      // a lone yellow door
        gs.gameMap = floor;

        const upper = controller.doorSpan(16, 15, 2, false);
        const lower = controller.doorSpan(16, 16, 2, false);
        const lone = controller.doorSpan(16, 20, 3, false);
        gs.gameMap = savedMap;

        check('a door pair is one two-tile door',
            upper.paired && lower.paired && upper.h === TILE_SIZE * 2 && upper.w === TILE_SIZE);
        check('both tiles of a pair agree on the span',
            upper.x === lower.x && upper.y === lower.y && upper.h === lower.h);
        check('a door without a partner is one tile', !lone.paired && lone.w === TILE_SIZE && lone.h === TILE_SIZE);
    }

    console.log = noop;
    for (const cell of saved) {
        gs.gameMap[cell.r][cell.c] = cell.tile;
        if (cell.decor !== undefined) gs.decor[cell.r * MAP_COLS + cell.c] = cell.decor;
    }
    resetLighting();
    controller.renderGame();
    console.log = origLog;
}

// ---------------------------------------------------------------- resilience
{
    let threw = null;
    console.log = noop;
    try {
        const saved = gs.gameMap;
        gs.gameMap = null;
        controller.renderGame();        // must bail cleanly, not explode
        gs.gameMap = saved;

        controller.zoomLevel = 0.5;
        controller.renderGame();
        controller.zoomLevel = 3.0;
        controller.renderGame();
        controller.zoomLevel = 1.0;
    } catch (e) {
        threw = e;
    }
    console.log = origLog;
    check('renderGame survives a null map and extreme zoom', threw === null,
        threw ? `${threw.constructor.name}: ${threw.message}` : '');
}

console.log('');
if (failures.length === 0) {
    console.log('All render checks passed.');
} else {
    console.log(`${failures.length} render FAILURE(S):`);
    failures.forEach(f => console.log('  - ' + f));
}

process.exit(failures.length === 0 ? 0 : 1);
