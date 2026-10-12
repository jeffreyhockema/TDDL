# TDDL Game -- Top-Down Doom-Like Game

A top-down 2D shooter inspired by classic Doom, featuring procedurally generated levels, multiple weapons, boss fights, and a retro pixel-art aesthetic.

## Quick Start

The game is plain static files: serve the project folder from any web server and
open it in a browser. An internet connection is needed for the CDN assets.

```bash
python -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` straight from disk will not
work -- browsers refuse to load ES modules and the asset packs over `file://`.

To run the headless logic tests (Node.js 22 or later):

```bash
node test/run.mjs
```

## Game Controls

### Movement
| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Move player |
| Shift (hold) | Run -- twice the walking speed, as in Doom. With **Always Run** on (pause menu) the marine runs and Shift walks |
| Mouse | Aim weapon |
| Left Click | Shoot weapon |

### Weapons
| Key | Weapon | Notes |
|-----|--------|-------|
| 1 | Knife | The fist: 2-20, always owned |
| 2 | Pistol | 5-15, first shot dead straight; starting sidearm |
| 3 | Shotgun | Seven pellets of 5-15 |
| 4 | Rifle | The chaingun: 5-15 a round, full auto |
| 5 | Rocket Launcher | 20-160 on impact plus a 128 blast |
| 6 | Plasma Gun | 5-40 a bolt, rapid |
| 7 | BFG | 100-800, then forty rays of 15-120; forty cells a shot |

The mouse wheel cycles weapons the way GZDoom's does: down for the next weapon,
up for the previous, wrapping round at either end and skipping anything not
carried or without ammo for a shot (the BFG needs forty cells). The knife is
always in the cycle. One wheel notch is one weapon; a trackpad swipe moves a
few at most.

### View
| Key | Action |
|-----|--------|
| - / _ | Zoom out |
| = / + | Zoom in |
| Ctrl + mouse wheel | Zoom (up in, down out); a trackpad pinch zooms too |
| M | Toggle the minimap |
| F3 | Toggle the performance panel |

### Menus
| Key | Action |
|-----|--------|
| Esc | Pause during play; in the pause menu, resume (or close the code box if it is being typed in); close the instructions |
| Enter | Start the game, restart after Game Over, or continue past the level tally; in the pause menu, Resume |
| Space | Continue past the level tally |

### Pause and fullscreen
Esc during play opens the pause menu over the frozen level, as Doom's Esc opens
its menu: **Resume**, **Enter Code**, **Fullscreen**, **Always Run** and
**Main Menu**. The
same menu is behind the **II** button at the top right of the view, which on a
desktop sits beside a fullscreen button, and on a touch screen at the end of
the row of zoom, map and fullscreen buttons. Esc does nothing on the start
screen, the level tally or Game Over: it never starts or resumes a game.

Pausing stops the simulation, lets go of every held key, the mouse button and
the touch sticks, and silences the game; resuming brings the sound back.

**Always Run** is Doom's setting of the same name: the marine runs by default
and Shift walks instead. It is remembered between visits (`js/settings.js`).
On a touch screen it is the only way to run -- the move stick tops out at
walking pace, the same as the keyboard without Shift. It used to run past 90%
of its travel, but its base follows a thumb that overshoots the rim, so an
ordinary swipe ran almost every time and touch players moved at double the
speed of keyboard players.

The game runs at the same speed on every display: the simulation advances in
fixed steps of 1/60 s, as many as the time since the last frame calls for
(`GameState.gameLoop`). It used to step once per screen refresh, which made a
120 Hz phone play everything at double speed and a struggling machine play in
slow motion.
Fullscreen takes the whole page, HUD and menus included, and the view re-fits
as it goes in and out. It is hidden where the browser cannot do it, as on an
iPhone. The browser's own Esc out of fullscreen does only that: it neither
pauses nor resumes. The logic is in [`js/pause-menu.js`](js/pause-menu.js) and
[`js/fullscreen.js`](js/fullscreen.js).

### Game controllers
Xbox, PlayStation, Switch Pro, 8BitDo and other controllers work over Bluetooth
or USB, through the browser's Gamepad API ([`js/gamepad.js`](js/gamepad.js)).
Press any button once with the game open: browsers only report a controller
after that.

| Control | Action |
|---------|--------|
| Left stick | Move -- analog, a light push creeps, a full one walks |
| LT (hold) | Run; with Always Run on, walk |
| Right stick | Aim; at rest, the marine faces the way he walks |
| RT | Fire |
| LB / RB, D-pad left / right | Previous / next weapon (skipping empty ones, as the wheel does) |
| D-pad up / down | Zoom in / out |
| Y or Back | Minimap on / off |
| Start | Pause / resume |
| Menus | D-pad or left stick to choose, A to press, B to go back, Start to start or resume; up and down scroll the instructions |

A hit rumbles the controller where it has motors. A controller that drops out
mid-level pauses the game, and while one is in use the touch sticks step aside
until the screen is touched again. Nothing about it is separate machinery:
movement goes through the touch move stick, aim and the trigger through the
mouse state, weapons through the wheel's cycling and pause through the pause
menu, so a controller plays by the same rules as everything else.

Some browsers only allow controllers on a secure page -- `https://` or
`localhost` -- so a controller paired to a phone may stay silent when the game
is opened by its plain `http://` LAN address.

### Cheat Codes
Doom's, typed during play with no console and no Enter, in either case. The
in-game instructions only hint that they work. Each answers on the message line
in the top-left corner, in Doom's own words. The logic is in
[`js/cheats.js`](js/cheats.js).

On a phone or tablet, with no keyboard to type into the game, the codes go in
through the pause menu instead: **Enter Code** opens a box for the phone's
keyboard, and what is typed there runs through the same matcher
(`cheatsInText`), so the same spellings work and nothing else does. A code that
works closes the menu and resumes, so its reply shows on the message line; one
that does not answers "Nothing happens." and waits to be corrected.

| Code | Doom | Here |
|------|------|------|
| IDDQD | God mode, health to 100 | The same. Separate from no-clipping, as in Doom |
| IDKFA | All weapons, full ammo, all keys, blue armour | The same: 200 points of blue, replacing whatever was worn |
| IDFA | IDKFA without the keys | The same |
| IDCLIP / IDSPISPOPD | No clipping | The same: walls, doors, props, barrels and the map edge |
| IDBEHOLD | Lists the power-ups | The same |
| IDBEHOLDV | Invulnerability, 30 s | No damage from anything, inverse grey palette, blinks as it runs out |
| IDBEHOLDS | Berserk | Melee x10 for the level, health to 100 |
| IDBEHOLDI | Partial invisibility, 60 s | Monsters' aim wanders up to 45 degrees; the marine is drawn as a smear |
| IDBEHOLDR | Radiation suit, 60 s | Lava, sludge and the rest do no damage; green tint. Doom's suit leaks on its worst floors; this one does not |
| IDBEHOLDA | Computer area map | Unseen walls and doors appear grey on the minimap for the level |
| IDBEHOLDL | Light amplification, 120 s | Everything in line of sight is lit at full bright; still nothing through walls |
| IDCHOPPERS | The chainsaw | The knife, taken in hand |
| IDDT | Automap: all lines, then lines and things, then off | The minimap: the whole level, then the level and every monster, barrel and pickup, then off. Opens the minimap if it was hidden |
| IDCLEV## | Warp to map ## | Warp to level ##. Doom restarts the game there; this keeps what you carry |
| IDMYPOS | Prints angle and position | Prints them, and toggles a live position and frame-rate readout |

IDMUS is left out: there is no music. Power-ups end with the level, as Doom's
did; god mode and no-clipping last until the game ends. Once "ID" has been
typed, a key that continues a code does nothing else -- the digits of IDCLEV do
not change weapon -- but the letters still steer the marine while they are
typed, as they always did.

## Objectives

- Reach the exit to clear the level -- but a boss or mini-boss seals it until defeated
- The enemies are Doom's monsters, and they hunt the way Doom's did: see [Enemies](#enemies)
- Collect colored keys to open matching doors -- red opens the way to yellow, yellow to blue, blue to the exit
- Find secret doors for bonus points
- Survive increasingly difficult levels
- Face boss enemies every 5th level
- Battle mini-bosses on random levels
- Cross -- or go around -- the lava, sludge and water pooled in the rooms
- Clear a level and you get a tally of what you did there; die and you get one for the run

### The level tally

Every level ends on a summary, the way Doom's did, and the next level does not
start until the player presses Continue (or Enter, or Space). It shows:

| Row | What it counts |
|-----|----------------|
| Enemies killed | Kills over the monsters that were on the level: `kills / (kills + whatever was still alive at the exit)`, dormant closet ambushes included. A corpse the Arch-vile raises and you kill again counts again, as in Doom. |
| Secrets found | Secret doors pushed open, over the secret doors the level was built with. |
| Items picked up | Keys, weapons, health packs, ammo packs, armour and powerups that actually did something -- a medkit walked over at full health stays on the floor and is not counted, nor does a green armour walked over at 100 points. |
| Time | Frames of play on the level, shown as a clock at 60 fps. Time on the tally or in a background tab does not count. |
| Score | The running score. |

The Game Over screen shows the same numbers totalled over the run -- the level
the player died on included -- plus levels cleared and the difficulty.

The bookkeeping lives in `GameState.levelStats` and `GameState.runStats`
(`js/game-state.js`). Monsters report a death with `recordKill()`, the player
reports a secret with `recordSecret()` and a pickup with `recordItem()`; the
level's secret doors are counted off the map when it is generated, and the
enemy total is closed off when the exit is reached. `levelComplete()` shows the
tally and sets `awaitingContinue`; `continueToNextLevel()` starts the next level,
and refuses if the player has died in the meantime.

## The Tileset

### Windows

A window ([`js/windows.js`](js/windows.js), `TILE_WINDOW`) is a wall you can see
and shoot through but not walk through. Doom builds one as a two-sided line
with a gap between the floor and the ceiling beyond: you watch the room, you
trade fire with it, and neither of you crosses. It is one of the cheapest good
things a Doom map does, and it falls straight out of the three questions this
code already asks a tile separately:

| Question | Predicate | A window |
|----------|-----------|----------|
| Can a body cross? | `isSolidAt` | No |
| Can a bullet cross? | `blocksShotsAt` | Yes |
| Can light and sight cross? | `blocksSightAt` | Yes |

`blocksShotsAt` is new, and the window is the reason it has to exist: before,
"solid" answered for bodies and bullets at once. A crate is the opposite case
-- it stops a shot but not a line of sight -- so all three now stand apart.

Two kinds, told apart by what is behind them rather than by a flag. An
**interior** window has open ground on both sides and looks into another room.
An **exterior** one has rock behind it for three tiles, so there is no room
back there and it must be the outside of the building: it is drawn as sky over
a dark horizon in the level theme's own palette (`WINDOW_OUTSIDE` -- night,
dusk, hellfire, toxic haze, cold dawn) and it lights the floor in front of it,
because Doom's sky is light level 255 and an exterior window is the brightest
thing on most maps.

Up to four runs of two or three tiles a level, one per room, cut only into
plain masonry well clear of corners and doorways. A window is solid to
movement, so cutting one can never change whether a level can be finished:
every solver counts it as wall.

### Terrain

Rooms flood. Three liquids can pool in them, and they are floors rather than
obstacles: nothing about them blocks movement, projectiles or sight. What they
change is what it costs to walk there.

| Tile | Damage | Speed | Lights the room |
|------|--------|-------|-----------------|
| Lava | 55/sec -- kills in under two seconds | 60% | Yes, brightly |
| Toxic waste | 10/sec -- a tax, not a sentence | 80% | Yes, faintly |
| Water | none | 62% | No |

Water is the interesting one. It costs nothing but time, which is a real cost with
something shooting at you, and it turns a flooded room into a decision instead of
scenery.

Everything each liquid does lives in one table -- `TERRAIN` in `js/constants.js` --
and the accessors in `js/terrain.js` read it. Adding a fourth liquid is a row in
that table plus a surface routine in the renderer; nothing else needs to know.

**A hazard is never the only way through.** The generator carves each pool
provisionally, floods the level from the player's start using only tiles that do no
damage, and takes the pool straight back out if anything that used to be reachable
no longer is. Lava is a shortcut, a thing to fight around, and a reason to take the
long way -- it is never a toll. Water is exempt from that test, because wading
costs time rather than health; a flooded cistern is allowed to make you swim for
the key.

Pools are also kept a full tile clear of every key, weapon, health pack, door and
the exit, so nothing is ever collected or opened while standing in a fire.

Terrain currently affects the player only. Enemies walk through lava unharmed and
at full speed; making it burn them too would be a change to combat balance rather
than to the tileset, and is deliberately not part of this.

### Themes

Levels cycle through five environments, each with its own masonry, floor and
liquids (`WALL_STYLES` in `js/constants.js`):

| Theme | Masonry | Floods with |
|-------|---------|-------------|
| Industrial Metal | Riveted plate | Toxic waste, water |
| Ancient Stone | Running-bond brick | Water, a little sludge |
| Volcanic Foundry | Basalt block | Lava, mostly |
| Toxic Refinery | Riveted plate | Toxic waste, water |
| Flooded Cistern | Running-bond brick | Water, mostly |

### Autotiling

Walls, doors and pools are drawn from their NEIGHBOURS, not tile by tile. The
shared machinery is `neighbourMask()` in `js/terrain.js`: it returns which of a
tile's eight neighbours are the same kind of thing, and the renderer decides from
that where edges and corners go.

- **Walls** are shaded on whichever sides front open ground. A side that continues
  into more wall gets nothing, so a corridor comes out as one unbroken mass with a
  single lit edge running its length. Outer corners get a quoin; inner corners --
  where two sides carry on but the diagonal does not -- get a short return, which
  is the one case a per-side rule alone gets wrong.
- **Masonry** is laid out in *world* coordinates and clipped to the tile. A pattern
  positioned relative to the tile restarts at every boundary and draws the 40px
  grid straight back onto the wall the edge shading just removed.
- **Doors** count as part of the wall run for that decision, so a door does not
  leave the masonry either side of it with raw exposed edges. Which way the run
  goes through the tile decides the door's orientation: jambs above and below with
  the leaves meeting on a vertical seam, or the same object rotated.
- **Pools** get a crust where the liquid ends and nothing at all in the middle of a
  lake, so a pool has a shoreline rather than a grid.

Liquid bodies are shaded by gradients that are periodic in world space (see
`drawLiquidBand` in `js/main.js`) rather than by a wash centred on each tile. The
obvious per-tile version puts a bright centre in every square and a lake comes out
as a chequerboard -- reintroducing, in the fill, exactly the grid the shoreline
autotiling exists to remove.

Each liquid then gets its own motion over that, because they do not move alike:
molten rock skins over into plates with the heat showing between them, sludge
blisters and pops, water runs in long ripples.

### Keys and doors

A key and the door it opens are drawn from the same palette (`KEY_STYLES` and
`DOOR_STYLES`), so the connection is made by recognition rather than memory. Keys
are drawn as keys -- bow, collar, shaft and bits -- rather than as a lettered
square, because a key is usually first seen at the far edge of the torch beam,
where a shape is recognisable and a letter is not.

**Doors open and close.** A keyed door is a thing, not a tile that vanishes
([`js/doors.js`](js/doors.js)). It starts locked; pushing into it with its key
unlocks it -- it has to be touched once, as a Doom door has to be used -- and
from then on it is an automatic door: it slides open whenever anyone comes
within `DOORS.TRIGGER_RANGE`, the two leaves parting from the seam into the
jambs with the floor showing through, and slides shut `DOORS.CLOSE_DELAY`
frames after the last of them has gone, never on top of anyone standing in it.
Monsters trip it too, as Doom's monsters open doors, but only once it is
unlocked; a locked door is a wall to them. Opening and closing each have their
sound. The tile never changes type; movement, line of sight, light, bullets
and the noise of gunfire all ask the door whether it is open (`isSolidAt()` in
`utils.js`, `isOpaqueAt()` in `lighting.js`), which is what lets light and sight
pour through an open door and stop at a shut one.

## Level Design

Regular levels are built the way a 1993 Doom map is built. You start somewhere,
fight your way around an area until you run into a locked door, keep exploring the
*same* area until the matching key turns up, walk back to the door, and repeat one
colour deeper until you reach the exit.

The generator is split in two, following the mission/space split Joris Dormans
describes for action-adventure levels:

- [`js/level-layout.js`](js/level-layout.js) decides the **mission** and then lays
  out **space** to fit it.
- [`js/map-generator.js`](js/map-generator.js) furnishes the result -- obstacles,
  weapons, health, secrets, terrain pools -- and generates boss arenas.

### Zones, gates and why the level cannot generate unwinnable

The playable rectangle is split BSP-style into **zones** separated by two tiles of
solid rock. Zone *i* holds key *i*, and the single gated corridor into zone *i+1*
is locked with key *i*. Corridors are clamped to their own zone rectangle, and the
only tiles ever carved out of the rock between zones are the gate crossings, so:

- the zone graph is a tree whose every edge is a locked door;
- each door spans the full width of its corridor, making it a genuine cut vertex;
- key *i* is in zone *i*, which by induction is open once you hold keys 0..*i*-1.

A level therefore cannot generate with its red key behind its red door. That is a
property of the construction, not something checked for afterwards and retried --
which is exactly how the previous generator worked, and why it could fail.

The verification is still run, because obstacles, secret passages and terrain are
laid in afterwards by code that does not know about zones. It is stronger than a
completability check: **every key is deleted in turn, and the level must become
unsolvable each time**. A level that stays completable without its yellow key is
not a level with a yellow key in it, and is thrown away and rebuilt.

### The rules the layout is trying to follow

| Rule | How it shows up |
|------|-----------------|
| Show the problem before the solution | Within a zone the key goes in the room furthest from the door, and *only then* is the entrance placed furthest from the key -- so no room is further from the door than the key is, and the player meets the lock first |
| Hub and spoke, not a straight line | A zone's gate usually hangs off the previous zone, but ~35% of levels attach one to an *earlier* zone, so a key found at the bottom of the map has to be carried back to a door near the start |
| Areas should loop | Rooms in a zone are joined by a spanning tree plus extra edges scaled to the zone's size, so you can run a circle around a fight instead of reversing out of a dead end |
| Every area needs somewhere to fight | The largest slot in each zone becomes an arena room |
| Contrast in every element | Each zone wears a different wall style, floor and terrain theme from its parent, changing exactly at the door |
| At least four secrets | Five to eight are attempted per level; five or six usually land |

### Every zone looks like somewhere else

Each zone is handed a wall style differing from its parent's, so passing a locked
door changes the walls, the floor *and* the liquid pooled in the rooms all at
once. A level typically runs something like a flooded cistern behind the red
door, a toxic refinery behind the yellow, an industrial hall behind the blue.

This is Romero's contrast rule, and his rule that a texture change should be
framed by a border rather than happening mid-wall. The frame is built in: two
tiles of solid rock and a door. The change lands exactly on the doorframe.

It is worth more than decoration. It gives the player somewhere to file the
memory -- *the yellow key was in the flooded part, the door back to the start was
in the metal part* -- which is the whole reason Doom levels change texture set
partway through instead of dressing a level in one theme.

Zones only ever avoid their **parent's** look, not every look on the level. With
five styles, insisting they all differ would just march a level through its whole
palette whether those palettes suited each other or not, and a zone that resembles
an earlier one is a help rather than a problem when you are trying to remember
where you have been.

`level-layout.js` hands out style *indices* and never learns what a style is;
`constants.js` owns `WALL_STYLES` and `main.js` owns the drawing. What reaches the
renderer is `gameState.tileStyles`, one style index per tile. It is `null` on boss
arenas and on the fallback layout, where the whole map shares the level's own look.

### Corridors are two tiles wide

Hallways, doorways and gates are two tiles across. A one-tile hallway is a queue:
you cannot strafe, you cannot get past the thing in front of you, and every fight
in it is decided by who shoots first. Doors span the full two tiles, so there is
nothing to walk around.

Secret passages stay **one** tile wide -- that difference is most of what makes
them read as secret.

A door pair is drawn as **one double door**, not two doors side by side: two
leaves meeting at the seam on the tile boundary, hinged at the outer ends, with
a single lock plate and status lamp on the seam. Each tile of the pair draws the
whole door clipped to itself (`doorSpan()` in [`js/main.js`](js/main.js)), so
the halves cannot disagree about where the seam is; a door with no partner --
the fallback layout's one-wide corridors -- is still a single-tile door.

### Level progression

| Level | Keys |
|-------|------|
| 1 | red |
| 2-3 | red, yellow |
| 4+ | red, yellow, blue |

Boss levels skip the key hunt entirely: one large arena, one or two antechambers,
and an exit the boss seals until it dies.

## Architecture

The game is built with vanilla JavaScript ES modules, HTML5 Canvas, and zero build tools.

### Module Dependency Graph

```
index.html
  └── main.js (GameController -- composition root)
        ├── constants.js (leaf -- shared config, no game-logic imports)
        ├── terrain.js (leaf -- terrain lookups and tile adjacency)
        ├── audio-system.js (sound design)
        │     └── audio-engine.js (leaf -- Web Audio synthesis, mix bus, reverb)
        ├── utils.js (leaf -- collision, camera, direction helpers)
        ├── enemy-sprites.js (leaf -- enemy atlas loading and frame lookup)
        ├── player-sprites.js (leaf -- player atlas loading and frame lookup)
        ├── item-icons.js (leaf -- pickup icon loading)
        │     (the three loaders above and audio-system.js read their art and
        │      sound through asset-pack.js -- leaf -- the asset pack decoder)
        ├── lighting.js (light sources, shadows, fog of war)
        ├── hud.js (leaf -- the status bar and its face)
        ├── input-handler.js (keyboard/mouse)
        │     └── mouse-wheel.js (leaf -- wheel weapon cycling and zoom maths)
        ├── touch-controls.js (twin sticks and buttons on a touch screen)
        ├── settings.js (leaf -- Always Run, remembered between visits)
        ├── gamepad.js (game controllers through the Gamepad API)
        ├── pause-menu.js (Esc, the pause menu, the corner buttons)
        │     └── fullscreen.js (leaf -- the Fullscreen API, with webkit fallback)
        └── game-state.js (owns the game loop)
              ├── constants.js
              ├── map-generator.js (procedural level generation)
              │     └── level-layout.js (leaf -- zoned lock-and-key layouts)
              ├── entities.js (Player, Enemy, Boss, MiniBoss)
              │     ├── hud.js
              │     ├── monsters.js (leaf -- the Doom bestiary and its AI formulas)
              │     ├── hitbox.js (leaf -- hit shapes and swept collision)
              │     ├── particles.js (leaf -- embers, bubbles, ripples, blood, decals)
              │     ├── enemy-sprites.js
              │     └── player-sprites.js
              ├── utils.js
              ├── weapons.js (bullets, health/ammo packs)
              └── audio-system.js
```

### Modules

| File | Description |
|------|-------------|
| `index.html` | Entry point, UI layout |
| `js/main.js` | GameController -- initialization, DOM binding, system coordination |
| `js/game-state.js` | Central game state, level progression, game loop |
| `js/constants.js` | Tile types, terrain table, level themes, weapon configs, difficulty settings |
| `js/terrain.js` | Terrain accessors and the neighbour mask that drives all autotiling |
| `js/entities.js` | Player, Enemy, Boss, MiniBoss entity classes; the Enemy class is the Doom monster AI |
| `js/monsters.js` | The Doom and Doom II bestiary -- every monster's numbers -- plus P_CheckMissileRange and P_NewChaseDir as pure functions, and the spawn tables |
| `js/hitbox.js` | Hit shapes (a box the size of a monster's drawn body, a circle the size of the player's) and the segment-sweep tests that decide whether a shot crossed one |
| `js/particles.js` | Embers and sparks off lava, bubbles and gas off sludge, ripples and splashes in water, blood spray and the stains it leaves |
| `js/map-generator.js` | Level generation: furnishing, secrets, terrain, boss arenas |
| `js/level-layout.js` | Doom-style zoned lock-and-key layouts, and the solver that verifies them |
| `js/weapons.js` | Weapon system, bullets, health/ammo packs |
| `js/audio-system.js` | Sound design: what every game event sounds like |
| `js/audio-engine.js` | Web Audio synthesis primitives, mix bus, generated reverb, voice budget |
| `js/input-handler.js` | Keyboard and mouse input handling |
| `js/mouse-wheel.js` | The mouse wheel's decisions as pure functions: which weapon it cycles to, and how wheel and trackpad travel add up to one switch or zoom step |
| `js/touch-controls.js` | Twin floating sticks and the top-right buttons on a touch screen |
| `js/settings.js` | Player preferences kept in localStorage, guarded so they fall back to the session when storage is blocked: Always Run |
| `js/gamepad.js` | Game controllers: reads the Gamepad API every frame and drives the touch move stick, the aim and trigger, weapons, zoom, the map, pause and the menus; rumble on hits |
| `js/pause-menu.js` | The pause menu for every device: Esc, the top-right pause and fullscreen buttons, code entry, releasing input on pause |
| `js/fullscreen.js` | The Fullscreen API on the whole page, with the webkit-prefixed fallback, and whether the browser can do it at all |
| `js/lighting.js` | Light sources, shadow casting, fog-of-war memory |
| `js/utils.js` | Collision, camera, direction helpers |
| `js/doors.js` | The keyed doors as things that lock, unlock, slide open for whoever is near and close behind them |
| `js/traps.js` | Monster closets and teleport ambushes: planned against the finished level, fired when the player crosses a trigger |
| `js/decor.js` | Room purposes and furnishing: solid props as wall tiles, floor detail, and the lights that lamps, screens, vats and furnaces give off |
| `js/sectors.js` | Doom's ambient light model: a light level per room, the specials that blink them, and daylight through a window |
| `js/windows.js` | Windows: solid to bodies, clear to shots and sight; interior ones look into a room, exterior ones look outside |
| `js/barrels.js` | Doom's exploding barrels: a destructible entity whose blast chains to the next |
| `js/switches.js` | Switch panels and the sliding walls they work: loot alcoves, and closets on a switch |
| `js/enemy-sprites.js` | Enemy atlas manifest loading, roster atlas preloading, frame lookup |
| `js/player-sprites.js` | Player atlas manifest loading, rotation pivot, frame lookup |
| `js/item-icons.js` | Pickup icon loading and centred, aspect-preserving drawing |
| `js/hud.js` | The status bar: writes the readouts, ARMS, keys and ammo table, and runs the marine's face -- its artwork, the choice of expression, and its timers |
| `js/asset-preloader.js` | The loading screen's machinery: waiting for an image to be decoded, and counting loads towards the progress bar -- pack downloads by their bytes as they stream, everything else as a step -- with stall and overall deadlines |
| `js/asset-pack.js` | The asset packs: parsing and unscrambling them (pure functions, usable in Node), and the browser loader that downloads each pack once, reports its bytes, and hands out entries as Images or raw bytes for audio decoding |

### Key Boundaries

- **`constants.js`**, **`terrain.js`**, **`utils.js`**, **`doors.js`**, **`level-layout.js`**, **`monsters.js`**, **`hitbox.js`**, **`particles.js`**, **`enemy-sprites.js`**, **`player-sprites.js`**, **`item-icons.js`**, **`asset-pack.js`** and **`hud.js`** are leaf dependencies -- they must not import from game-logic modules
- **`game-state.js`** owns the game loop; **`main.js`** owns initialization, DOM binding *and* all rendering
- **`entities.js`** and **`map-generator.js`** are the largest modules -- candidates for future decomposition

> **Note:** all rendering lives in `GameController` (`js/main.js`). A `js/renderer.js`
> module used to exist alongside it but was dead code -- nothing imported it, its
> `draw()` was never called, and it had diverged from the working renderer. It has
> been removed. Older documents under `docs/plans/` still reference it; treat those
> as historical.

## Lighting and Fog of War

Lighting lives in [`js/lighting.js`](js/lighting.js) and drives both what the player
*sees* and what the game considers *revealed* -- from a single computation, so the
two can never disagree.

### Sector light: what Doom actually does

Doom has no point lights. None. Every sector carries a light level from 0 to
255 that the mapper set by hand, and that is the whole of its lighting -- the
lamp in the corner is a decoration, and the corner is bright because somebody
typed a number in. The contrast between one sector and the next is the main
tool a Doom level has for drawing the eye.

This game grew the other way round, as a dark world lit by a torch and a few
real point sources, which left every room the same shade of black -- the one
thing a Doom level never is. [`js/sectors.js`](js/sectors.js) adds the missing
layer: the overhead lighting a room is assumed to have.

- **A room is a sector.** Every tile of a room shares one light level, so the
  light is flat across a room and steps at its threshold, exactly as Doom's
  does. Levels are drawn from Doom's own numbers (208, 192, 160, 144, 112, 80,
  48 out of 255) and scaled so the brightest room sits at `MAX_AMBIENT` 0.55 --
  the torch is 1.0, so a lit room is a place you can see across rather than
  daylight.
- **Corridors run darker** than the rooms they join, and a room's purpose
  biases it: a laboratory is lit and working, a crypt is not.
- **Light spills** a couple of tiles through a doorway rather than stopping
  dead at it. A Doom mapper does this by hand with a sector of middling
  brightness in the doorway; here it is two passes over the finished grid.
- **A wall takes its light from the floor it faces**, at `WALL_SHARE` of it. A
  Doom wall has no light level of its own, which is why a wall bounding a
  bright hall is bright on the hall side and black on the other.
- **Light specials** are Doom's sector types: `blink` (types 2 and 3, mostly on
  and dropping out briefly), `flicker` (types 1 and 17, a broken light), and
  `glow` (type 8, a smooth swell). About one room in five gets one.

Ambient light does **not** hand the player the map. It is gated on the sight
polygon exactly as the terrain glow is, so a lit room is lit the moment there
is a line to it and black until then. That gate is geometric, not directional:
you take in the whole of the room you stand in whichever way you face, and rock
is what hides the next one. Walking up to a doorway and having the room beyond
resolve all at once is the Doom moment this buys.

The grid is planted into the light map (gated) and painted into the render mask
as flat per-room fills through the same gate, so what looks lit and what counts
as revealed still come from one computation.

**Light sources.** The world is lit by a list of sources. The player contributes
two: an omnidirectional glow and a directional flashlight cone. Each is resolved
into a shadow polygon by casting rays until they hit an opaque tile (walls and
closed doors both block light).

**What the light does.** Anything the light touches is drawn at full brightness --
floors, walls, doors, items, pickups and enemies alike.

**Vision sources.** Light is not the only way to know something is there. A second
list, resolved by exactly the same shadow casting, describes what the player can
*make out* without illuminating it. The player contributes one: peripheral vision,
a 180-degree arc reaching a little past the end of the beam. Walls, doors, items and
enemies inside it register as dim, colourless silhouettes -- enough to know a
corridor turns left or that something is moving off to your side, nowhere near
enough to tell what colour it is.

The two are kept in separate grids on purpose. `lightMap` is illumination;
`visionMap` is awareness. Everything that asks how bright a place is reads the
former and gets an honest zero for ground the player has merely sensed, which is
what stops peripheral vision from becoming a second, wider torch. `isTileLit()` asks
the narrow question, `isTileSensed()` the other, and `isTilePerceived()` the union --
usually the one gameplay wants.

**What memory does.** A persistent world-space surface records where light has
actually fallen, keeping the **brightest value each point has ever reached**.

That maximum matters. The surface stores light as a grey level rather than as alpha,
because canvas has no maximum operator for alpha -- `lighter` adds and `source-over`
blends, and both converge on fully-lit under repetition. Stamping the same view every
frame therefore inflated dim edges to fully explored in about fifteen frames: the
revealed area kept growing after the player stopped moving, and its boundary settled
into a circle around the glow instead of the shape of the light. Combined with
`lighten` the stamp is idempotent -- an unchanged view can be recorded a thousand
times and nothing moves. `MEMORY_GAIN` lifts faint light before the maximum is taken,
so a glimpsed corner is remembered clearly without reintroducing any drift.

The gain also has to be high enough. Memory records `max(light * MEMORY_GAIN)`, so
wherever that product stops reaching 1 there is a saturation knee -- and since it
depends only on distance, that knee is a **circle centred on the player**, which
renders as an unexplained curved edge cutting across wall tiles. At a gain of 3 it
sat 78% of the way along the beam and was plainly visible; the value is chosen to
push it past the useful length of the beam. Once the light moves on, *static* geometry (floors, walls, doors)
is redrawn dim through that surface, so the layout you have explored stays legible
and its boundary follows the shape of the beam rather than snapping to whole tiles.
*Dynamic* things -- items, pickups, enemies -- are never drawn from memory: they
vanish with the light. Projectiles, explosions and combat flashes are the exception;
they emit their own light and stay visible in the dark.

What peripheral vision made out is remembered too -- you do not forget a corridor
turned left because you never shone the torch down it -- but at
`MEMORY_SENSE_GAIN` rather than `MEMORY_GAIN`, so a glimpse is remembered *as* a
glimpse. Run at the beam's gain it saturated identically, and geometry the player
had only sensed came back from memory in full colour, underneath the very wash whose
job is to take that colour away.

**The beam fades across its width.** Canvas gradients are radial only, so a cone
filled in one pass is equally bright right across the beam and ends at a hard
angular edge. Each light is therefore resolved on its own layer and multiplied by a
**conic gradient** via `destination-in`, giving a continuous angular profile.
`angularFactor()` is the same curve analytically, used by the tile light map, so
gameplay and visuals agree.

> Approximating this by stacking progressively narrower fans does not work: it
> yields one flat plateau per fan -- six of them spanning 8 degrees and 56 pixels
> each, far wider than the blur can hide -- and the beam edge visibly stairsteps.

**Straight shadows.** Rays are traced with a DDA grid walk that lands exactly on
tile boundaries, so every ray stopped by the same flat wall stops on the same plane
and the light's edge is straight. (Sampling a ray at fixed intervals instead makes
neighbouring rays stop at slightly different depths, which renders as a staircase.)

**A wall is lit at the face that fronts walkable ground.** A ray stops dead on the
near face of the tile that blocks it and is never extended past it, so wall, door and
secret-door tiles are never inside the lit polygon. They are lit separately, and the
rule is deliberately the same one floor tiles get: take the ground just in front of
the block -- ground the player could stand on to look at it -- and ask this source
how brightly it lights that spot. `litWallFace()` does it, and the brightest face a
block has is the one it is drawn from.

Everything else follows from that one rule.

*Sidedness.* Two rooms separated by a wall two blocks thick have one block fronting
each room. A lamp in the west room can see the ground in front of the west block, so
that block lights; the east block's only face looks into the east room, which is
behind solid rock, so it stays dark however bright the west side gets. A spur
standing out into a room has a face on either side, and which one lights depends on
where the lamp is -- including the case where it reaches round the end of the spur
and genuinely lights both, which is right.

*One layer.* A block with no face at all -- nothing walkable orthogonally adjacent,
and no walkable corner -- can never be lit, so the reveal stops at the first layer of
wall around the space the player is in. Rock behind that layer borders only other
rock and stays black.

*Corners.* A block whose orthogonal neighbours are all solid can still front the room
at a corner, and that is the tile at the corner of every rectangular room. Those are
measured diagonally instead -- but only when there is no straight face, or a wall
could be lit around the outside of a corner it does not front.

Each span of wall is drawn as a **gradient sampled along its own face**
(`WALL_FACE_SAMPLES_PER_TILE`), not as a flat tile. That is what lets a pillar throw
its shadow *across* a wall rather than the wall switching on and off as a unit. The
beam's angular profile is not applied here: the conic gradient puts it on per pixel
afterwards, exactly as it does for the floor, so a wall and the ground at its foot
agree.

Each span is **cleared before it is painted**. The blurred floor polygon stops on the
wall's near face but bleeds a few pixels into the tile, and left to accumulate the
two summed to pure white while the floor immediately in front sat around 0.7.

Two things that look like shortcuts here are not:
- Taking the brightest neighbouring *floor* tile, which is what this used to do, has
  no notion of sides at all. A wall between two rooms took whichever room happened to
  be better lit, and a spur lit from the left read as lit from the right as well.
- Reading a strip of the lit floor and stretching it through the tile, which is what
  replaced that, gets the sides right but measures how deep rays *penetrate* a tile
  rather than what lands on its surface. It also cost a canvas blit per wall, which
  made it four fifths of the frame.

> Do not be tempted to "just extend the ray a tile into the wall" so the polygon
> covers it. Crossing one tile at a grazing angle takes `TILE_SIZE / sin(theta)`,
> which runs past fifty tiles as the angle approaches zero -- that is what threw
> long arcs of light straight through walls into the rooms beyond.

### Tuning

Every knob is in the `LIGHTING` object at the top of `js/lighting.js`:

| Constant | Effect |
|----------|--------|
| `FLASHLIGHT_RANGE` | How far the beam reaches |
| `FLASHLIGHT_HALF_ANGLE` | Beam width (half-angle; `PI/3` = 120 deg total) |
| `GLOW_RADIUS` | Radius of the all-directions glow around the player |
| `PERIPHERAL_HALF_ANGLE` | Width of the peripheral arc (`PI/2` = 180 deg total) |
| `PERIPHERAL_RANGE` | How far peripheral vision reaches |
| `PERIPHERAL_INTENSITY` | How strongly sensed shapes are drawn -- this is the wash's alpha |
| `PERIPHERAL_EDGE_SOFTNESS_PX` | Blur on the arc's coverage; 0, because a blur is the most expensive thing in a frame and the arc shows it least |
| `MEMORY_BRIGHTNESS` | How dim remembered geometry is drawn (0-1) |
| `MEMORY_GAIN` | How strongly a lit glimpse is committed to memory |
| `MEMORY_SENSE_GAIN` | The same for a peripheral one; much lower, so a glimpse stays a glimpse |
| `REVEAL_THRESHOLD` | Light needed before an item or enemy is shown |
| `SENSE_THRESHOLD` | Awareness needed before one is made out peripherally |
| `CONE_RIM_SOFTNESS` | Fraction of the beam's width over which it fades to nothing |
| `CONE_CAST_MARGIN` | Extra arc a cone casts beyond the beam it shows |
| `WALL_FACE_SAMPLE_PX` | How far in front of a wall's face its light is measured |
| `WALL_FACE_SAMPLES_PER_TILE` | How finely a face is shaded along its length |
| `EDGE_SOFTNESS_PX` | Blur on the light mask; 0 gives hard-edged light |
| `RAY_ARC_DEGREES` | Shadow-edge resolution -- lower is smoother and slower |
| `LIGHT_ORIGINS` | How many points a source is cast from. The first knob to turn for CPU: it multiplies both the ray casting and the polygon fills, and dropping it to 1 costs the soft shadow edge but nothing else -- flutter was measured against it and does not depend on it |

Per-source falloff is set by the `stops` array on each light in
`createPlayerLights()`. A source may also override `rimSoftness`, `castMargin`,
`originCount`, `originRadius` and `arcDegrees` individually; peripheral vision does,
because it is a flat dim wash that needs neither a penumbra nor a fine shadow edge
and is by far the widest source in the frame.

### Adding more light or vision sources

`collectLightSources()` is the single extension point for light. Anything pushed onto that
array gets shadow casting, tile illumination, fog-of-war memory and rendering with
no other changes -- for example a lamp carried by an enemy:

```js
for (const enemy of gameState.enemies) {
    if (enemy.carriesLamp) {
        lights.push({
            id: `enemy-lamp-${enemy.id}`,
            x: enemy.x, y: enemy.y,
            kind: 'point',              // or 'cone' with direction + halfAngle
            range: TILE_SIZE * 4,
            intensity: 0.7,
            stops: [[0, 1], [1, 0]],
        });
    }
}
```

`collectVisionSources()` is its counterpart for perceiving without illuminating --
a motion tracker, a creature's own sense of the room it is in, or a temporary
see-through-the-dark power would each be one more descriptor pushed there, in the
same shape.

### Terrain glow

Lava and toxic waste are that extension point in use. Each glowing pool pushes real
light sources into `collectLightSources()`, so a lava lake casts a pillar's shadow
across the floor, lights the wall behind it, reveals what is standing beside it, and
is remembered afterwards -- none of which a tile merely painted bright would do.

The cost of that is real: every source is a full ray cast plus its own pass over the
mask, and a volcanic level can have two hundred glowing tiles. Three things bound it:

- **Emitters, not tiles.** `buildHazardEmitters()` floods each connected pool once
  per level and drops emitters along it at `HAZARD_EMITTER_SPACING` intervals. A
  puddle gets one; a long channel gets a line of them running down it.
- **A safety valve, not a budget.** `HAZARD_LIGHT_MAX` bounds the count, but it is
  set well past what generated levels carry -- about fifteen emitters in a whole
  level -- so in practice every pool in range is lit, all of it, from every emitter
  it has. That matters: a cap that bites decides each frame which parts of which
  pools are lit from wherever the player happens to be standing, and a pool is a
  fixture of the level. There was a per-pool cap of two, and it meant a lake lit only
  the stretch nearest your feet, with that bright patch sliding along it as you
  walked past and the far end sitting dark. Lighting every pool fully costs a ray
  cast apiece: measured at +0.19ms on a scene with six lakes, far more than a real
  level has.
- **A cull radius equal to the sight range.** `HAZARD_LIGHT_CULL` is
  `SIGHT_RANGE`, not a number of its own. Glow is gated through the sightline, so an
  emitter past that range contributes nothing whatever it does -- culling there is
  free by construction, and culling any *nearer* puts a second, invisible edge
  inside the first, which is what used to make a pool wink out while it was plainly
  in view.

They are also cast cheaply -- one origin, a coarse arc -- because everything the
extra fidelity buys is a graded penumbra at a shadow's edge, and that is invisible
under a glow this faint. `HAZARD_LIGHT_MAX` is the first number to lower if frames
get expensive on a lava level.

**Glow you cannot see.** A pool's light is cast from the pool, so on its own it
lights the room it is in whether or not the player can see that room -- and it
used to: a lava pool next door lit its own walls, the light mask let them
through, memory recorded them and the minimap drew the room, all through a
solid wall. Terrain lights are therefore flagged `gated`, and a gated light
counts only where it overlaps the player's **sight** -- a line-of-sight polygon
cast from the player every frame (`createSightline()`), flat, hard-edged, and
reaching `SIGHT_RANGE`, well past the torch, because a glow at the end of a long
corridor is visible from the far end of it. The tile light map
applies the gate per tile; the renderer multiplies the glow's pass through a
sight stencil (`sightMaskCanvas`) before adding it to the mask; and since
memory and the minimap are both derived from those, a glowing room appears in
all three the moment the player looks into it, and not before. The player's own
torch and glow are not gated. Embers drifting off lava, which are drawn outside
the mask, ask the same question before they are drawn.

**Sight reaches all round.** It began as a half-circle facing the way the player was
aimed, on the reasoning that eyes have a front. That made a lit room close the moment
they turned their back on it and open again when they looked round, which reads as a
second torch rather than as a room: a pool of lava is a fixture, and it should go on
lighting the corridor you left it in. So the sightline is a point source. What still
gates it is geometry, which is the part worth having -- the polygon is occluded
exactly like a light's, so a lit room on the far side of a wall stays hidden until
there is a line to it, and turning a corner closes it because rock is in the way and
not because of where anyone is looking.

It follows that a monster standing in a pool's light is visible there too, whatever
the player is facing: creatures are drawn wherever the tile light map exceeds
`REVEAL_THRESHOLD`, and that map is what the gate is applied to.

Peripheral vision stays a half-circle in front, and the two are not in conflict.
Sensing the shape of an unlit thing is a different act from seeing a lit one, and
light is what you see by.

### Why nothing shimmers

A hairline is only crisp if it lands on a whole device pixel, and the camera almost
never puts one there. The seams between floor plates were drawn inside the world
transform, so each one's weight split across two pixels in a ratio that changed as
the player walked: the floor grid visibly breathed, and settled somewhere different
every time they stopped. Measured in a browser, the contrast of the sharpest seam
swung between 7 and 14 across a single pixel of camera movement -- a factor of two.

The seams are now snapped to the same whole pixels the tiles are drawn on, so every
one is exactly one pixel at full weight whatever the camera is doing, at any zoom.
The same swing is now 12 to 14. The classic half-pixel offset does not help on its
own, because it only lands on a pixel centre when the transform is whole-pixel to
begin with.

Tile fills are grown by one device pixel so neighbours overlap
(`tileBleed()`). Two abutting fills each cover part of the pixel they share, and
`source-over` does not add them back to one: at a 30/70 split about a fifth of what
is behind them shows through, which is a dark seam around every tile whose weight
also moves with the camera. The overlap costs nothing -- the later tile covers the
earlier one's spill, exactly as it already did.

### Why it does not flutter

The lit area has to change *smoothly* as the player moves and turns, and this is
easy to get wrong without noticing: a still screenshot of a flickering scene looks
perfect, because the fault only exists between frames. Two things guarantee it, both
guarded by `test/stability.test.mjs`.

**The fan is cast on a fixed grid of angles.** Rays used to be measured from the
beam's own direction, so every one of them swept across the scene as the player
turned. A ray's hit distance is bimodal beside a corner -- it either catches the
corner or slips past it -- so every corner in view flicked a long shadow spike on
and off, and turning on the spot made the whole lit area crawl. On a fixed grid the
ray directions are the same set whatever the player faces; turning only changes
which of them are cast, so a given corner is always measured by the same ray. On
screen, turning a quarter degree went from a worst-case jump of 37/255 to 4/255.

The arc lands up to one ray-step from where it was asked for, which nothing can see:
the beam's visible edge is the conic profile, which uses the true direction, and the
fan is cast a wide margin past it anyway.

**A point is read from both rays either side of it, blended.** Occlusion used to
come from whichever single ray was nearest, so the instant the light moved enough
for that to become a different ray, the answer flipped the whole way from lit to
dark -- half a pixel of movement could jump a tile by 0.45 out of 1. Blending turns
that step into a ramp one ray-step wide, which is both continuous under motion and a
fair reading of a corner: the fraction of the gap between two rays that is open
really is how much light gets through there.

> Neither fault is fixed by casting more rays or averaging more origins. Both were
> measured against those knobs and neither moved: finer rays make each spike
> narrower without making it smaller, and more origins only divide it. The fix has
> to be to stop the sampling moving.

### What a frame costs

Lighting is by far the most expensive thing this game does, and it is worth knowing
where the cost actually sits, because it is not where it looks.

**Count calls, not pixels.** Which of those two you are bound by decides what is
worth doing, and they point opposite ways. A software-rendered browser is bound by
fill rate, so a full-screen blur dominates and a thousand small calls vanish into the
noise; a GPU-backed canvas is the other way round, and per-call overhead is most of
the cost. Timings taken in the first will send you the wrong way for the second.

Counting canvas calls per frame is hardware-independent, so it is the measure to
optimise against when the target machine is not the one under your hands. It is also
what found the terrain cost below: a room with six pools of waste was spending 2,270
extra calls a frame, 240 of them building gradient objects that were thrown away and
rebuilt on the next.

**Draw detail only in the pass that shows it.** Static geometry is drawn three times
a frame -- remembered, sensed, lit -- and only one of those is ever read closely:

| mode | brightness | detail | why |
|---|---|---|---|
| `lit` | full | everything | the pass the player reads |
| `sensed` | full | none | the peripheral pass washes the layer colourless |
| `memory` | 45% | none | nothing survives at 45% |

Masonry is the most expensive part of a wall and walls are the most numerous thing on
screen, so confining it to the lit pass is the single biggest saving the split makes.
The moving liquid surface, the shoreline's hot and cold lines, and the halo over
glowing terrain go the same way. It is the honest reading as well as the cheap one:
you do not make out the current in a pool you have half noticed at the edge of your
vision.

**Build a gradient once.** Canvas gradients are objects, and building one costs more
than the fill that uses it. Two were being made per liquid tile per frame for the
mottling bands -- but a band's gradient is snapped to a whole period, so every tile
lying in the same band shares an identical one, and a screenful of a pool spans only
a handful of periods. Keeping them for the pass took 239 gradients a frame down to
41. The halo over glowing terrain went further: it is the same picture in a different
place every time, so it is painted once into a sprite and stamped.

**Let sources share a pass.** A source only needs a pass to itself if something has
to be multiplied through its own coverage afterwards -- which now means only a beam's
angular profile. Everything else just adds, so all of it goes in one pass: the
fans are summed on the staging layer, softened together in one blur, and their wall
spans painted on after. That is what makes glowing terrain affordable, because a
level lit by lava has a source per pool: nine sources come out as three passes, and
a pass is a blur and a composite over the whole screen. Measured on a room with six
pools, batching them was 1.8x faster than a pass apiece.

The falloff had to move for this to work: it is now the fan's own fill rather than a
`destination-in` afterwards, because `destination-in` scales everything already on
the layer rather than just the source that asked for it. It costs nothing either
way -- a canvas radial gradient is exactly the falloff curve. Sources are grouped by
softness, since the blur is what a pass is built around.

**Measure the wall, do not blit it.** The wall pass used to read a strip of the
coverage fan out of a canvas and stretch it over each tile. That put a canvas blit --
for a while, one reading the surface it was writing to, which forces a snapshot per
call -- in the frame's hottest loop, and made the pass four fifths of the frame.
Measuring each face directly instead is a handful of arithmetic per wall and a
gradient fill per span, and it is also the more correct answer, so the shape of the
code and the shape of the picture improved together.

It also lets unlit walls go uncollected. The old collector handed back every wall in
range of the beam and left the shading to discover most of them were dark; in a room
full of pillars that was six times the tiles, each still costing a full set of draws.

**Never let a canvas be its own `drawImage` source** -- worth stating anyway, because
it is the trap that made the old pass so expensive and it is easy to fall into again.
A canvas used as its own source has to be snapshotted on every call so the read stays
consistent with the writes.

The rest, in order of what they were worth, none of them changing a pixel:

- **Scope every pass to the source it is drawing.** A source is resolved with a
  blur, a gradient fill and a composite apiece, and running each over the whole
  canvas meant the player's three-tile glow cost exactly as much as one covering the
  screen. `sourceScreenBounds()` bounds a cone as a *sector* -- apex, arc ends, and
  whichever axis directions fall inside the arc -- which is roughly half the area of
  the circle it sits in. The memory stamp is scoped the same way, off the rectangle
  the masks report touching, which matters because that is the loop that runs
  `MEMORY_GAIN` times.
- **Runs, not tiles.** A face's read is offset from its tile *across* the face and
  is the identity *along* it, so a row of tiles sharing a face direction can be
  drawn as one blit that lands exactly where the individual blits would have. Rooms
  and corridors are long straight walls, so this collapses the draw count by around
  2.4x. `faceRuns()` does the grouping and `test/render.test.mjs` proves it loses no
  face, invents none, and preserves which face a doubly-exposed tile ends on.
- **One fan per source, not two.** Open ground and walls want the same coverage fan
  under the same blur and differ only in what they do with it afterwards, so
  `stageLightFan()` resolves and softens it once and both passes read it. That
  halves the full-surface blurs, which are the most expensive operation a canvas
  offers. The floor's distance falloff moved from being painted into the fan before
  the blur to being multiplied in after it -- a difference of blurring the gradient
  across four pixels of a four-hundred-pixel range.
- **Seams in device pixels, in one path.** The hairlines between floor plates were
  stroked per tile inside the world transform, which both put them mid-pixel (see
  below) and cost a `beginPath`/`stroke` for every visible tile. They are now one
  snapped path for the whole viewport.
- **A blur only where it shows.** `EDGE_SOFTNESS_PX` is per-source. Peripheral
  vision sets it to zero: its shadow edges sit under a wash at 34% alpha, where the
  few pixels of penumbra that matter on a lit floor are invisible.

Together those took a frame from about 296ms to about 79ms on a software-rendered
browser, measured across ten positions in generated levels -- and left the game
cheaper *with* peripheral vision than it had been without it.

Press **F3** in game for the breakdown, or type **IDMYPOS** for just the frame rate. The cost
moves a great deal with where the player is standing -- a junction with wall faces on
every side is several times a bare room -- so compare like with like.

The panel's top two rows are the ones to read first, and they answer different
questions. **frame** is how long a frame actually takes, wall to wall; **draw** is how
much of that this renderer spent in JavaScript. A large gap between them means the
time is going somewhere the panel cannot see -- browser compositing, the GPU catching
up, or the game's own update loop -- and that making the drawing code cleverer will
not help.

Canvas calls are queued rather than executed, so `draw` measures how long it took to
*ask* for the frame, not to paint it: a slice that looks cheap can still be expensive
on the GPU. Treat the slices as a ranking, not a stopwatch. On a software-rendered
browser, where the two numbers nearly meet, `mask` is about half the frame, `memory`
a fifth, and `cast` -- all the ray tracing, for every source -- under one percent.

Two levers remain if a frame is still too expensive. `PERIPHERAL_RANGE`: the arc is
the widest source in the frame, and both its fan and its wall work scale with the
area it covers. And `LIGHT_ORIGINS`, which multiplies the ray casting and the polygon
fills both.

Note what is *not* a lever. Glowing terrain adds a light source per pool, and it is
tempting to blame the frame rate on them -- but measured against a room with six
pools, the mask pass does not grow at all, because sources sharing a pass is
precisely what that costs. What grows is the pass that draws the pools: the liquid
surface, its shoreline and its halo. The lights are nearly free; the artwork is not.

### How a frame is drawn

1. **Masks** -- one per source list, built by the same routine. Each source's
   shadow polygon is filled with a radial gradient, combined additively so
   overlapping sources brighten each other and blurred by `EDGE_SOFTNESS_PX`; then
   its wall spans are painted on from the light measured at their exposed faces.
   The persistent seen surface is stamped from these same masks, so what is
   remembered can never differ in shape from what was drawn.
2. **Memory pass** -- dim static geometry onto its own layer, clipped by the
   persistent seen surface.
3. **Sense pass** -- geometry, items and enemies at full brightness, clipped by the
   *vision* mask and then drained of colour with a flat cold wash (`source-atop`,
   so the tint cannot spill past the arc). Composited under the lit pass, so where
   the beam also falls the lit world simply covers it and the arc leaves no seam at
   the beam's rim.
4. **Lit pass** -- the same content again at full brightness, clipped by the
   *light* mask with `destination-in`.
5. **Composite** -- the masked lit layer over the sensed one over the dim memory,
   giving a soft-edged beam that fades back through peripheral awareness into
   remembered geometry. The player and emissive effects are drawn last, outside
   every mask.

## Status Bar

The bar along the bottom is Doom's, redrawn rather than scaled up from a
bitmap. Left to right:

| Section | Shows |
|---------|-------|
| AMMO | The rounds left in the pool the weapon in hand draws from, in big red numerals; a dim dash for the knife, which takes none (Doom left it blank) |
| HEALTH | Health as a percentage; it throbs at a quarter or less |
| ARMS | Slots 2-7 in Doom's three-by-two grid, yellow once owned, the weapon in hand underlined in red. The knife's slot 1 is always owned and only appears on touch screens |
| The face | The marine, reacting to the fight (below), with the score on a small plate under him |
| ARMOR | Armour points, green or blue for the class worn and dimmed with none |
| Keys | Three slots, a keycard lighting in each as it is found |
| Ammo table | Every pool, held over capacity -- BULL, SHEL, RCKT, CELL -- with the one in use marked |

The level number is not on the bar: the canvas already shows it, top left,
beside the message line.

It is built from HTML and CSS in `index.html` (`#uiContainer`) -- a riveted,
brushed grey-brown plate, each readout in a recessed well, numerals in
[Oxanium](https://fonts.google.com/specimen/Oxanium) with a top-lit gradient --
so it is sharp at any size. Every length is a multiple of a hundredth of the
bar's height, which follows the window: about an eighth of the screen, 108px
at 1600x900. The canvas ends where the bar begins
(`GameController.updateCanvasSize`), so the marine sits in the middle of what
can actually be seen, and a `ResizeObserver` refits the canvas whenever the
bar changes height. A number that changes gives a short pulse: brighter for a
gain, a white flash for a loss. AMMO only pulses on a gain, because every shot
spends some.

`js/hud.js` writes into the bar. Every Player method that changes something
on it (`updateHealthDisplay()`, `updateWeaponUI()` and the rest) calls
`updateStatusBar()`, and the render loop calls `tickStatusBar()` once a frame.
Writes are diffed against what is already on screen, so the many refreshes
that change nothing touch no DOM. The same diff spots a number going up or
down, which is what pulses it and what the face reacts to.

### The face

Doom's marine looked out of the middle of the bar and showed how the fight was
going. This one is original artwork, an SVG drawn in code (`FACE_SVG`): a
marine in a green combat helmet with the visor pushed up. Every expression's
parts are present at once. CSS shows the right ones from three attributes on
the frame -- `data-tier`, `data-mood` and `data-look` -- so a change of face is
one attribute write. `chooseFace()` picks the face in Doom's order of priority
(`ST_updateFaceWidget`):

| Mood | When |
|------|------|
| dead | Health at 0: eyes shut, head dropped, colour drained, the visor cracked |
| grin | For two seconds after the number of weapons owned goes up (a new gun, IDFA) |
| ouch | A single hit costing more than 20 health (Doom's `ST_MUCHPAIN`): eyes wide, mouth open |
| hurt | For a second after any hit, the armour soaking it all included: brows down, teeth set, looking *towards* it |
| rampage | The trigger held for two seconds: squint and bared teeth |
| god | God mode or invulnerability: glowing gold eyes, a smirk, a gold bezel |
| idle | Glancing about now and then, and blinking |

Health sets the tier, by Doom's sum: 80% and up is the healthy face, then a
cut, then blood from under the helmet, then a swollen eye and a split lip, and
under 20% a face that has had enough. Wounds build up from tier to tier, and
at the last two tiers the resting face looks pained. Because the view is from
above, "towards the hit" is measured on screen: a monster left of the marine
makes the face look left, and one above or below him, or a hazardous floor, is
taken full-face. For that, `Player.takeDamage()` records a hit counter and
where the hit came from. A monster's attack and a blast both pass their
position.

### On touch screens

The ARMS slots become the weapon buttons (`js/touch-controls.js` binds every
`[data-weapon-name]`), all seven of them, the knife's included. The rest of the
bar lets thumbs through to the sticks. On a phone held upright the readouts
and the face share the top row and the seven buttons fill the row below, each
showing its pool's count, so the ammo table is folded into them. In landscape
everything fits on one short row, with the table back and the buttons showing
only their numbers. Safe-area insets pad the sides and the bottom.

## Minimap

A semi-transparent overview in the top-left corner, toggled with **M**. It is drawn
straight from the lighting module's `exploredMap` -- the same record that decides
which geometry is redrawn dimly on screen -- so it fills in as the level is explored
and never shows a room the player has not actually seen, by torchlight,
peripherally, or by the glow of lava they have a line of sight to (a glowing
room behind a wall stays off the map until they look into it; see
[Terrain glow](#terrain-glow)). It clears itself whenever lighting memory does, which is on every new
level.

Two things can show it more, both Doom's: the computer area map (IDBEHOLDA) adds
every unseen wall and door in grey, and IDDT shows the whole level as if walked,
then every thing on it as well. Either can be switched off again, so a change
of mode redraws the surface from scratch rather than stamping over it.

Tiles are stamped one world pixel each into a persistent `MAP_COLS` x `MAP_ROWS`
surface and blown up on the way out with smoothing off, so drawing the panel costs a
scan for changes plus one blit rather than two thousand rectangles a frame.
Interpolating instead would smear a revealed corridor into the black around it and
show the player walls they have not found.

A tile is restamped when its *type* changes as well as when it is first revealed, so
a door the player has opened stops being drawn as a door and a pickup they have taken
stops being drawn as a pickup. Colours, position and scale are in the `MINIMAP`
object in [`js/constants.js`](js/constants.js); they are deliberately not the wall
style's, because at three pixels a tile the in-world palette is mud and doors have to
be told apart at a glance.

### Rooms with a purpose

A carved room is a rectangle of floor. [`js/decor.js`](js/decor.js) gives each
one a purpose to suit its zone's look, and furnishes it:

| Look | Room kinds |
|------|-----------|
| Industrial Metal | **cargo bay** (crate stacks, hazard stripes, ceiling lamps), **plant room** (machinery along the walls with warning lamps, cables and vents underfoot, tanks), **barracks** (lockers), **storage** (shelving, barrels) |
| Toxic Refinery | **lab** (benches in the middle, consoles and vats against the walls lit by their own screens and by the green in the vats, drains), plant room, storage |
| Ancient Stone | **crypt** (rows of sarcophagi, bones and rubble, braziers burning at either end), **hall** (pillars down both sides, a mosaic aisle, braziers) |
| Volcanic Foundry | **forge** (furnaces glowing against the wall, slag on the floor, barrels), hall, storage |
| Flooded Cistern | **cistern** (a pillared undercroft, grates and puddles, moss, dark), storage |

Three kinds of thing go into a room. **Solid props** -- crates, vats, pillars,
machines, lockers, sarcophagi -- are `TILE_PROP` tiles in the map with a
decoration id saying which. A prop is solid to movement and to shots, so you
can take cover behind a crate, but not to light or to sight: it is a thing
standing in the room, lit exactly as the floor around it is (with its own drop
shadow, top face and side face to read as an object), the wall behind it is
lit as usual, monsters see over it, and gunfire is heard past it. The
solvers, the minimap and the reachability rule all know the tile. **Floor
detail** -- grates, stripes, cables, puddles, rubble, bones,
drains, moss, slag, plates, mosaic -- is drawn over the floor and affects
nothing. **Lights**: a ceiling lamp, a console's screen, a vat, a furnace, a
brazier and a machine's warning lamp each contribute a real light source,
budgeted and gated by sight exactly as the terrain glow is, so a lab you look
into is lit blue-green by its own equipment before your torch reaches it.

Placement is by the room's geometry, not by chance. The planner works out
where a room is entered, which wall is its **back** (a wall nobody comes
through, facing the busiest doorway), which way it is long, and where its
corners are, and lays the room out the way it would be used: a cargo bay's
pallets stacked in the back corners with loose crates along the back wall,
the loading edge striped in front of them and an aisle of plate running to it
from the door; a plant room's machinery banked on the back wall with a tank
in each corner beside it and a cable running straight out from every machine
to a vent; lockers lining a barracks' side walls; shelving and lab benches in
parallel rows with two-tile aisles; a lab's console bank on the back wall
with vats in the corners and a drain in each aisle; sarcophagi in two ranks
with braziers in the four corners and bones lying between the tombs; a hall's
colonnade evenly spaced down both sides with a mosaic aisle up the centre
and braziers flanking each doorway; furnaces banked on the back wall with
slag cooling in front of their mouths and the stock kept in a front corner;
a cistern's pillars on a grid with a channel of grates down the middle and
puddles at their feet. Lamps hang on a symmetric grid sized to the room.

Every solid prop is placed under one rule: nothing the level could reach before
is unreachable after. The planner floods the map from the player's start before
it begins and after each group of props, and reverts any group that cuts
anything off; doorways and item tiles get a clear margin on top of that, and a
room's solids are capped at a fraction of its floor so there is always room to
fight. The start room is left plain. The progression verifier runs after all of
it, as it always did.

### Barrels and switches

**Exploding barrels** ([`js/barrels.js`](js/barrels.js)) are Doom's: twenty
points of damage set one off, and it blasts everything within two tiles for
128 (scaled as monster damage is), which sets off the barrel beside it, and so
on down the row, each with a short fuse so a chain reads as a chain. A barrel
is an entity rather than a tile -- solid to bodies and in the way of shots,
transparent to light and sight -- hit through the same shapes and collision
pass as a monster, and its blast is the rocket launcher's own explosion, so
everything that explosion already hurts, a barrel hurts. Barrels are loud:
monsters hear one go off. From the second level on, up to five groups of two
to four stand against the walls of the rooms where barrels belong -- cargo
bays and storerooms above all -- never beside a doorway or an item.

**Switches** ([`js/switches.js`](js/switches.js)) are used sparingly: at most
two a level, from the second level on. A switch is a panel on a wall
(`TILE_SWITCH`), pressed by pushing into it or by shooting it, as Doom's
could be, and it works once. Two things a switch can do:

- **Open an alcove.** A pocket dug into the rock beside a room holds a health
  pack and a weapon, sealed by a section of the room's own wall
  (`TILE_SLIDE`) that slides sideways into the rock when the switch -- on a
  *different* wall of the same room, so you see it move -- is pressed. The
  wall is solid and opaque until it has slid most of the way, then stays open.
- **Open a closet.** One of the level's monster closets may be wired to a
  switch instead of its floor trigger: press it and the wall opens.

Every solver treats sliding walls and switches as walls, so a level with an
alcove in it is exactly as solvable as one without: an alcove is a reward,
never the way through.

### Traps

Doom's levels do things because you did something: grab the key and the walls
of the room slide away to reveal what was waiting behind them; walk to the
middle of the room and a squad teleports in at your back. Both were sealed
rooms of sleeping monsters and a linedef trigger. [`js/traps.js`](js/traps.js)
plans the same two things for every level from the second on -- about one per
three rooms, never the start room, at most `TRAPS.MAX_PER_LEVEL`:

- **Monster closets.** A pocket two tiles wide and one deep, dug into the solid
  rock beside a room and sealed by the room's own wall, with a couple of
  monsters inside from the start of the level -- dormant: undrawn, unhittable,
  not listening. The trigger is the tiles around the room's item, if it has one
  (grab the key and the wall opens), else a block at the room's centre. Crossing
  it opens the wall in a grind and a cloud of dust, and the monsters wake with
  their eyes on you and come out -- usually behind you, since the closet is on
  a wall you have already walked past.
- **Teleport ambushes.** The same trigger, in rooms that got no closet. Crossing
  it picks floor tiles in the room at least three tiles from you and by
  preference behind you, and monsters arrive there in Doom's green teleport
  flash, already awake and already after you.

Planning changes nothing about the map: a closet is only chosen where its
pocket, its door and a ring of rock around them are all solid and unreserved,
so the level the progression verifier checks is the level the player gets, and
opening a closet can only ever add a dead-end pocket to the room it faces.

## Enemies

The enemies are the monsters of Doom (1993) and Doom II (1994), with the numbers
id Software gave them and an AI ported from the monster half of Doom's
`p_enemy.c`. The roster and its numbers live in [`js/monsters.js`](js/monsters.js);
the behaviour is the `Enemy` class in [`js/entities.js`](js/entities.js).

### The roster

Every monster is a character from `sprites/enemies/`. The CraftPix packs have
the right *builds* for most of Doom's bestiary but not the right colours, and
Doom's monsters are known by colour as much as by shape -- the Imp is brown, the
Demon pink, the Baron pink and the Hell Knight tan, the Arch-vile yellow, the
zombies grey-green. So most of the roster is a **Doom-coloured variant** of a
pack character, built by `tools/build_doom_monsters.py`: it reads an atlas the
enemy build has produced, repaints it by hue band (everything green becomes
hide-brown, keeping its own shading), and writes it back as a character of its
own with the source's geometry. Six monsters use a pack character as it comes.

| Doom monster | Game | Character | From | Why | HP | Attack |
|--------------|------|-----------|------|-----|---:|--------|
| Zombieman | I | `zombieman` | `robber` | a plain human; skin gone zombie-green, clothes to khaki | 20 | one bullet, 3-15 |
| Shotgun Guy | I | `shotgun-guy` | `thug` | the heavier, bald human in black | 30 | three pellets, 3-15 each |
| Imp | I | `imp` | `male-goblin` | a clawed humanoid, its green turned hide-brown | 60 | fireball 3-24, or claws 3-24 |
| Demon | I | `demon` | `earth-monster` | squat and wide, turned pink | 150 | bite 4-40 |
| Spectre | I | `demon` at 28% opacity | | Doom's Spectre *is* a Demon drawn with a fuzz effect | 150 | bite 4-40 |
| Lost Soul | I | `lost-soul` | `pirate-skeleton` | a skull; its hair burns orange | 100 | charge 3-24 |
| Cacodemon | I | `cyclops` | as is | red, one-eyed, horned -- a Cacodemon with legs | 400 | fireball 5-40, or bite 10-60 |
| Baron of Hell | I | `baron` | `giant-goblin` | the big brute in pink hide; also the mini-boss, as on E1M8 | 1000 | green plasma 8-64, or claws 10-80 |
| Cyberdemon | I | `minotaur` | as is | the horned giant | 4000 | three rockets, 20-160 + splash |
| Spider Mastermind | I | `zeus` | as is | lightning for a chaingun; nothing in the packs has eight legs | 3000 | twin shotgun bursts |
| Heavy Weapon Dude | II | `chaingunner` | `caveman-boss` | the big one, shirt turned red | 70 | sustained bullets, 3-15 each |
| Hell Knight | II | `hell-knight` | `giant-goblin` | the Baron's build in tan, as Doom's Knight is the Baron's sprite in another colour | 500 | as the Baron |
| Revenant | II | `skeleton-knight` | as is | an armoured skeleton with missiles | 300 | missile 10-80, half of them homing; punch 6-60 |
| Mancubus | II | `mancubus` | `rock-monster` | the wide, slow one, grey rock turned brown hide | 600 | three pairs of fireballs, 8-64 each |
| Arachnotron | II | `ice-monster` | as is | blue plasma, on a chassis | 500 | sustained plasma, 5-25 each |
| Pain Elemental | II | `pain-elemental` | `medusa` | a thing whose attack is spawning things, in rust-brown | 400 | releases Lost Souls; three more on death |
| Arch-vile | II | `arch-vile` | `anubis` | tall and thin, turned bone-yellow | 700 | fire attack 20 + 70 blast, needs line of sight; resurrects corpses |
| Wolfenstein SS | II | `pirate-guy` | as is | the blue uniform | 50 | sustained bullets |

To rebuild after changing a rule or the enemy atlases:

```bash
python tools/build_enemy_sprites.py      # the 42 pack characters
python tools/build_doom_monsters.py      # then the Doom-coloured variants on top
```

Every number is Doom's, unscaled. Hit points do not grow with the level and
nothing changes with the difficulty: an Imp is 60 hit points and a 3-24 claw on
level twelve as on level one, on Hard as on Easy, because Doom's was. Damage is
the original dice, rolled as `P_Random` rolled them. Speeds, sizes, pain
chances, reaction times and attack timings are the original tics and map units:
a Demon is two and a half times as fast as a Zombieman, an Arch-vile outruns
everything but a running marine, and a Cyberdemon is twice an Imp's size. A
monster sees as far as its line of sight reaches, as in Doom, which had no
limit.

**Difficulty** follows Doom's skill levels rather than touching the monsters
(`getDifficultyMultipliers` in `js/constants.js`). Doom's skills decided how
many monsters a map placed -- E1M1 has 10 on the easy skills, 17 on Hurt Me
Plenty and 24 on Ultra-Violence -- and on the easiest the player took half
damage. So: Easy is *I'm Too Young To Die*, with six monsters for every ten and
every hit halved; Medium is *Hurt Me Plenty*; Hard is *Ultra-Violence*, with
fourteen monsters for every ten. Nothing else changes.

Regular levels draw from the first game's bestiary in roughly the order Doom
introduced it, and Doom II's additions arrive from level 6 (`SPAWN_TABLE`). Boss
levels alternate the Cyberdemon and the Spider, as episodes two and three did.

The 24 characters the roster does not use (the tribal warriors and their
leaders, the wizards, the pirate captain, the mushroom folk, the bandits, the
yeti, Horus and the Pharaoh) are still in the manifest and can be swapped in by
changing a monster's `sprite` field.

### How they behave

The AI is a port of `A_Look`, `A_Chase`, `P_CheckMissileRange`, `P_NewChaseDir`
and the target rules of `P_DamageMobj`, reorganised around a per-frame update.

**Standing.** A monster stands where it was placed, facing one direction. Every
ten tics it checks whether the player is in the half-circle in front of it with
a clear line of sight -- or, if a weapon has been fired within earshot, whether
it heard that. Nothing wanders. A quarter of monsters are placed "in ambush":
deaf, waiting to be seen, and woken by noise only if they can also see you.

**Noise.** Every attack the player makes, the knife included, is `P_NoiseAlert`:
the sound floods outward through open tiles and wakes everything it reaches.
Closed doors block it, as they do in Doom; a step limit stands in for the
mapper's sound-blocking lines. Firing a pistol in a quiet room is a decision.

**Chasing.** A monster that has a target walks at it in one of eight directions,
for a random handful of steps, then chooses again (`P_NewChaseDir`): the direct
diagonal, then the longer axis, then the shorter, then whatever it was doing,
then a sweep round the compass, and only as a last resort straight back. That
algorithm is the zig-zag every Doom player recognises. Monsters and the player
are solid to each other, so a crowd queues at a doorway rather than merging.
A monster never forgets its target: once it has seen you it hunts you until one
of you is dead.

**Firing.** At the end of each run of steps a monster may attack. In melee reach
it always does. Otherwise `P_CheckMissileRange` rolls against the distance:
point blank it always fires, at range about one chance in five, and a handful of
monsters have their own rules (the Arch-vile will not attack beyond fourteen
tiles, the Revenant punches rather than fires up close, the Cyberdemon and Spider
treat every distance as half what it is). A monster that has just been hurt
always fires back. Zombies, the Chaingunner, the Spider and the SS are hitscan:
instant bullets with Doom's 22-degree spread, drawn as a brief tracer. Everything
else throws projectiles at Doom's speeds and Doom's sizes -- a projectile's
`radius` in the bestiary is `info.c`'s, in map units, and is both what it
collides at and how big it is drawn: 6 for an Imp, Cacodemon, Baron or
Mancubus fireball, 11 for a rocket and the Revenant's tracer, 13 for
Arachnotron plasma. The Mancubus fans three pairs; the
Cyberdemon fires three rockets; the Revenant's missile homes half the time; the
Chaingunner, Arachnotron and Spider keep firing until a refire roll fails or
they lose sight of you.

**Pain.** Every hit rolls against the monster's pain chance. A success cancels
whatever it was doing for a few tics -- the Imp flinches four times in five, the
Baron once in five, the Arch-vile almost never -- which is what lets a chaingun
stun-lock an Imp and why a Baron shrugs off a pistol. A Lost Soul in flight
cannot be stopped.

**Infighting.** A monster hurt by another monster turns on it, unless it is
already committed to a target (`threshold`, a hundred steps from the last time it
switched), and stays on that target until it dies. Hitscan fire hits whatever is
in the way; a projectile stops on any monster in its path and damages it unless
the two are the same species, in which case it bursts harmlessly -- Imps behind
Imps fizzle their fireballs. The Cyberdemon's rockets hurt everything in the
blast but itself and the Spider, and nobody ever turns on an Arch-vile, which in
turn takes revenge on anyone at all.

**The specialists.** The Lost Soul charges in a straight line and bites the first
thing it hits, wall or monster or you. The Pain Elemental's attack is to release
a Lost Soul already flying at you, and it releases three more when it dies, up to
Doom's cap of twenty in a level. The Arch-vile's attack is a fire that appears at
your feet and follows you through a long wind-up: if it can still see you when it
goes off you take the hit and stand in the blast, and if it cannot, nothing
happens -- break line of sight. While an Arch-vile lives, corpses are never
cleared, and it raises any it walks over, at full health.

**Tuning.** `MONSTER_DAMAGE_SCALE` (1), `SIGHT_RANGE`, `NOISE_RANGE_TILES` and
`AMBUSH_CHANCE` at the top of `js/monsters.js` are the knobs; everything else is
the bestiary itself, quoted in Doom's map units and tics so it can be checked
against the source.

### Hit detection

A shot counts when the segment it travelled this frame, thickened by its own
radius, crosses the target's **hit shape** ([`js/hitbox.js`](js/hitbox.js)).
Two things were wrong before, and both made shots pass visibly through a
sprite without landing:

- The hit region was the movement circle -- a disc at the monster's feet
  around a third the size of the artwork, which stands on it and rises two
  radii above. A round through the chest missed the maths. A monster's hit
  shape is now a box the size of its drawn body, from the manifest's body
  dimensions at the scale the sprite is actually drawn; the player's is a
  circle the width of the artwork, a third wider than the movement radius.
- The test was "does the bullet overlap the target right now". A rifle round
  moves 12px a frame; a graze could be on one side of it one frame and the
  other side the next. The sweep cannot be stepped over at any speed.

The collision pass takes the **nearest** thing a bullet crossed, not the first
in the list, and a bullet that dies on a wall in the same frame still counts
the monster it passed through on the way. Monster hitscan fire and the player's
melee reach use the same shapes: a knife reaches the edge of a Baron's body,
not its centre. Movement collision is unchanged and still uses the circle.

### Effects

[`js/particles.js`](js/particles.js) is a small pooled particle system with
two draw passes, matching the renderer's: things that give off light (embers,
sparks, the gas over sludge) are drawn in the emissive pass and are visible in
the dark like the pools themselves; everything else (water, blood) is drawn on
the lit layer and seen only where the torch falls.

| Where | What |
|-------|------|
| Lava | Embers lift off, wobble and dim; the odd crackle of sparks; wading throws sparks |
| Toxic waste | Bubbles swell and burst, each leaving a wisp of gas that drifts and spreads |
| Water | Points of light on the surface; a splash and ring on entering; ripples while wading |
| Being shot | Blood sprays on along the shot, with a little back-spatter and a puff at the wound. Monsters bleed in their own colour (the Cacodemon blue, the Baron and Hell Knight green), and a kill bleeds in every direction |

Blood that stops moving becomes a **decal**, a stain on the floor drawn under
the entities, so a corridor you fought through looks fought through. Stains
are capped (`PARTICLES.DECAL_MAX`) and the oldest go first; particles are
capped too, and the pools only breathe within `PARTICLES.AMBIENT_RANGE` of the
player.

## Enemy Sprites

Enemies are drawn from 42 hand-animated characters -- goblins, skeletons,
wizards, pirates, mythological bosses -- each with a full set of directional
animations.

### What ships in the repo

| Path | Contents |
|------|----------|
| `sprites/enemies/manifest.json` | Index: every character's cell size, atlas layout, ground anchor, and the frame range of each animation |
| `sprites/enemies.pak` | The atlases of the characters the bestiary wears (~3.3 MB), one ~200 KB atlas each holding all 240 frames; see [Assets](#assets) |
| `sprites/enemies-extra.pak` | The rest of the collection (~7 MB), only downloaded if the roster names a character the main pack lacks |
| `tools/build_enemy_sprites.py` | Regenerates the manifest and the atlases (`sprites/enemies/<slug>.png`, not committed) from the original art, then repacks |
| `tools/build_doom_monsters.py` | Repaints eleven built atlases into Doom-coloured monsters (`zombieman`, `imp`, `baron`, ...), adds them to the manifest, then repacks |

The source packs are ~2.6 GB and live outside the repo. A single character is
330 frames of 480x480 PNG, so the raw art is never served to the browser;
`tools/build_enemy_sprites.py` bakes it down to about 10 MB of atlases in
total, of which the game downloads only the third its monsters wear.

### Animations

Each character provides seven animations. Four are directional (`down`, `up`,
`left`, `right`); the death animation is shared across directions.

| Animation | Plays | Triggered by |
|-----------|-------|--------------|
| `idle` | loops | standing still |
| `idle_blink` | loops | standing still, every few seconds, so idle enemies aren't statues |
| `walk` | loops | a slow monster (a Zombieman, a Mancubus) on the hunt |
| `run` | loops | a fast one (a Demon, an Arch-vile), or a Lost Soul in flight |
| `attack` | once | the wind-up of a melee blow or a shot (the archer characters draw a bow here) |
| `hurt` | once | taking damage and surviving |
| `dying` | once | being killed |

One-shot animations own the enemy's appearance until they finish, so a swing is
never cut off mid-arc. Being hit interrupts an attack, and death interrupts
anything.

A killed enemy is not removed at once: it plays its death animation, holds the
final pose briefly, then clears. It is inert throughout -- no AI, no movement,
and it cannot be damaged again. Drops are still awarded the instant it dies, so
loot lands where the enemy fell.

### Sizing

Every atlas is baked at one body height, and on-screen size is derived from the
enemy's own Doom collision radius: figure height is `ENEMY_SPRITE_BODY_PER_RADIUS`
(2.6) radii times the monster's `spriteScale`. Seen from above it is the
footprint that reads, so each monster's `spriteScale` is solved for the width
of its Doom sprite -- a Zombieman, Imp or SS trooper stands 40 map units
across, a Demon 60, a Cacodemon 63, a Baron 65, a Mancubus 82, an Arachnotron
92 -- and a tall, narrow one like the Revenant or Arch-vile comes out taller
than a grunt, as its Doom sprite is. The marine is Doom's 16-unit radius with
his shoulders spanning it, half a tile across and narrower than a Zombieman,
which is the proportion Doom's sprites have. Frames are cropped to the union of all of a character's poses, so a
weapon that swings well outside the idle silhouette is never clipped, and the
manifest's ground anchor keeps the character planted while it does.

### Which character an enemy gets

Each monster in the roster names its character in `js/monsters.js` (the table
under [Enemies](#enemies)), so a Doom monster has one look and can be told
apart at a glance, as the originals could. The roster's atlases -- about a
third of the collection -- are fetched and decoded behind the loading screen
before the start menu appears, so no level begins with a monster still on its
shape fallback. A failed atlas is logged and that monster keeps its shape, so a
slow or failed load costs polish rather than the session.
`pickRandomEnemySprite()` remains as the fallback for a character missing from
the manifest.

### Rebuilding

```bash
python tools/build_enemy_sprites.py --source "<path to the sprite packs>"
python tools/build_enemy_sprites.py --only minotaur,assassin   # just these two
python tools/build_doom_monsters.py                            # then the Doom recolours
python tools/build_doom_monsters.py --preview sheet.png        # ...with a contact sheet
```

Each tool rebuilds the enemy packs when it finishes, reading which characters
go in the main pack from the `sprite:` fields in `js/monsters.js`; after
changing the roster, run `python tools/pack_assets.py enemies` so the new
characters move into the pack that is always downloaded.

The Doom variants are repainted from the built atlases, so they must be rebuilt
after the pack characters they come from.

Requires Pillow and NumPy. `--body-height` changes the baked resolution and
`--colors 0` disables palette quantisation (5x larger, no visible difference).

The bosses are monsters too -- a Baron of Hell on mini-boss levels, the
Cyberdemon and Spider Mastermind on every fifth level -- so they draw from the
same atlases with the same animation state machine. Their `spriteScale` is
solved the same way as everyone else's, so a Cyberdemon is twice a Zombieman
across, as in Doom, without inflating its collision radius.

## Player Character and Weapons

### The character

The player is Doom's marine: the sprite pack's man, recoloured at build time
into green armour with brown hair (`doomguy` in `tools/sprite_recolor.py`).
The uniform's khaki is moved to the armour green with its own shading kept, the
backpack is turned leather brown so it still reads on a green back, and the
hair -- painted in the same near-blacks as the boots, so it cannot be told by
colour -- is found by position: the dark blob on the pivot in every upright
frame, and around the face in the six death frames. Skin, straps, boots and
weapons are untouched. The pack's second character is not built.

`pickRandomPlayerCharacter()` picks from whatever the manifest holds, which is
one character today; that is the single place to change when the game grows a
character-select screen.

| Path | Contents |
|------|----------|
| `sprites/player/manifest.json` | Cell size, atlas layout, rotation pivot, and each animation's frame range |
| `sprites/player.pak` | The marine's atlas, holding every frame of every weapon set; see [Assets](#assets) |
| `tools/build_player_sprites.py` | Regenerates the manifest and the atlas (`sprites/player/man.png`, not committed) from the original art, recolouring the man into the marine on the way, then repacks |

Unlike the enemies, who are drawn from four fixed viewpoints, these are top-down
sprites with a **single facing that is rotated** to wherever the player aims. The
source art aims straight down; the manifest records that as `sourceAngle` and the
renderer rotates by `aim - sourceAngle`.

Finding the point to rotate about is most of what the build script does, and it
comes from the art rather than being assumed. Pixels opaque in almost every frame
are the head and shoulders -- limbs and weapons swing between frames, so they
drop out of that mask. The centre of what survives is the character's body, and
from directly above that is the middle of the head, which is the point a person
turns around. The manifest records the box as `bodyX`/`bodyY`/`bodyWidth`/
`bodyHeight` and the pivot as its centre, so the relationship is checkable rather
than implicit.

> **Fixed:** an earlier version took the pivot's *X* from the weapon axis -- the
> line the muzzle flash and flame lie on -- so the barrel would stay exactly on
> the aim ray. That line runs down the character's extended arm, so the sprite
> swung around its own shoulder when turning. Bullets spawn along the aim ray
> from the player's position regardless, so all that bought was the muzzle lining
> up with them. The weapon now sits a little to one side of the aim ray, which is
> how someone holding a weapon in front of them looks from above.

> **Source note:** the pack ships these animations twice. Under `PNG Animations`
> each animation has its own tightly-cropped canvas with nothing recording how
> the crops relate, so switching animation would jump. The build reads
> `PNG_Bodyparts&Animations_version_2` instead, which is the same artwork on a
> uniform 512x512 canvas.

### The weapons

The roster is Doom's, weapon for weapon, and so are the numbers: damage dice,
fire rates, spreads, projectile speeds, the blast and the BFG's spray are
p_pspr.c's and info.c's, in Doom's tics and map units (`WEAPON_STATS` in
`js/constants.js`). Nothing scales with the level or the difficulty. Damage is
rolled per shot from the weapon's dice, `mult * (1 + P_Random() % sides)`, as
Doom rolled it.

| Weapon | Doom's | Damage | Rate | Where it comes from |
|--------|--------|--------|------|---------------------|
| Knife | Fist | 2-20, reach 64 units | every 22 tics | Owned from the start |
| Pistol | Pistol | 5-15, hitscan; the first shot of a burst is dead straight, the rest have the 5.6-degree refire spread | every 14 tics | Owned from the start, with 50 bullets |
| Shotgun | Shotgun | seven pellets of 5-15, hitscan, each with the 5.6-degree spread | every 37 tics | Found from level 2 |
| Rifle | Chaingun | 5-15, hitscan, always spread | a round every 4 tics | Found from level 3 |
| Rocket Launcher | Rocket launcher | 20-160 on what it hits, then a 128-point blast over 128 units that falls off to nothing at the edge, needs line of sight, and hurts the shooter in full | every 20 tics, 20 units a tic | Found from level 6 |
| Plasma Gun | Plasma gun | 5-40 a bolt | a bolt every 3 tics, 25 units a tic | Found from level 8 |
| BFG | BFG9000 | the ball does 100-800 to what it hits; when it bursts, forty rays of 15-120 fan out over 90 degrees from where the shooter *stands*, in the direction they face, each hitting the first thing it meets within 16 tiles (`A_BFGSpray`) | every 60 tics, 25 units a tic, 40 cells a shot | Found from level 12 |

Every weapon refires while the button is held, as Doom's did (`A_ReFire`).
The pistol, shotgun and rifle are hitscan: instant, traced with the same
`traceShot` the monsters' guns use, stopping on the first monster, boss or
barrel along the ray or the wall behind -- where a bullet throws a puff and can
throw a switch.

**Ammunition** is Doom's four pools, shared between the weapons that shared
them (`AMMO_TYPES`): bullets (200) for the pistol and rifle, shells (50),
rockets (50), and cells (300) for the plasma gun and BFG. A weapon's `ammo`
reads and writes its pool, so the pistol and rifle always agree. A new game
starts with 50 bullets. Ammo lying on the map is Doom's boxes -- 50 bullets,
20 shells, 5 rockets, a 100-cell pack -- and what a monster drops is the small
pickups: a 10-round clip, 4 shells, a rocket, a 20-cell. A found shotgun holds
8 shells, a chaingun 20 rounds, a rocket launcher 2 rockets, a plasma gun or
BFG 40 cells.

The sprite pack has artwork for a knife, a pistol, a rifle, a bat and a
flamethrower -- and nothing else. Four of the seven weapons are therefore drawn
with the **flamethrower**, told apart by colour:

| Weapon | Art |
|--------|-----|
| Shotgun | the flamethrower, untouched |
| Rocket Launcher | its tank recoloured to black metal, its flame greyed into a launch flash |
| Plasma Gun | tank and flame recoloured blue |
| BFG | tank and flame recoloured green, with a glow around both |

The recolours are generated at build time by `tools/sprite_recolor.py` from the
flamethrower's own frames, so they are frame-for-frame identical to it and fire
from the same muzzle. Isolating the weapon from the character is done by colour:
the tank is the only strongly red region of any size on the character (keeping
only the largest connected red region guards against small red details), and the flame is picked out by being far
brighter than the khaki uniform that shares its hue, and by always sitting below
the body in the source art.

Shots leave the barrel rather than the middle of the player -- see the muzzle
note under *The character* above -- and pistol and rifle rounds are drawn small.

### Muzzle flashes

The attack frames in the pack have a muzzle flash painted in -- a metre of
flame, in the flamethrower's case. Those are **stripped at build time** and the
game draws its own instead. Each firing weapon carries a `muzzleFlash`
descriptor (colour, size, frames, and how much light it throws), and when it
fires:

- the renderer draws a bloom and a short tongue at the barrel, additively, in
  the emissive pass so it shows in the dark;
- the lighting pass turns the same descriptor into a brief point light in the
  weapon's colour, so the room flickers around the barrel.

Both read one descriptor, so the flash on screen and the light it casts always
agree. The painted flashes had to go because the recolours could change the tank
but not convincingly the flame, and because a flash that is part of the sprite
shows on every attack frame rather than only the one that fires.

Stripping (`strip_flash` in `tools/sprite_recolor.py`) cannot rely on colour:
the flame's darker body, the character's skin and the khaki sleeve all overlap
in hue, saturation and brightness, and on the pistol the flash physically
touches the hand. A colour-only version walked straight up the forearm and the
man's whole left arm vanished on every rifle shot. What separates flash from
character is *position*: the flash's top edge on the firing axis is measured
first, and everything above that line is gun and hand. The eraser's seed must
sit at or below the line; below it the region may grow through warm or
soft-edged pixels; for a short reach above it, only through glow fringe or
white-hot pixels (never opaque skin or cloth); and beyond that reach not at all.
The builder refuses to let stripping change a single pixel above that reach.

The muzzle is first located from the flash in the *unstripped* frames, then
refined on the stripped frame to the lowest opaque pixel on the firing axis --
the actual end of the barrel -- so the drawn flash emanates from the tip rather
than from a point a little short of it.

### Pickup icons

| Path | Contents |
|------|----------|
| `sprites/items/manifest.json` | Icon name -> file and size |
| `sprites/items.pak` | One icon per pickup, a few KB each; see [Assets](#assets) |
| `tools/build_item_icons.py` | Regenerates the manifest and the icons (`sprites/items/<name>.png`, not committed) from the original art, then repacks |

Weapons declare an `icon` and, where they take ammunition, an `ammoIcon`. The
four flamethrower-based weapons get the flamethrower icon in their colour, and
their ammunition is the fuel cylinder in the same colour, so a pickup's colour
says which weapon it belongs to before it is close enough to read. Both weapon
tiles and dropped ammo packs draw the icon over a glowing pool in the weapon's
colour -- these rooms are unlit and the artwork is mostly dark metal, so
without the pool a rifle on the floor is invisible. Anything with no icon, or
whose icon has not loaded yet, falls back to a lettered label on the same pool,
so a row of pickups always reads as one set.

### Rebuilding

```bash
python tools/build_player_sprites.py --source "<path to the pack>"
python tools/build_item_icons.py --source "<path to the pack>"
```

Both require Pillow and NumPy. `--body-width` changes the player's baked
resolution, `--size` the icons', and `--colors 0` disables palette quantisation.
Both rebuild their pack when they finish.

### Title logo

`sprites/logo.png` is the TDDL logo on the start screen, the same one the
game's website uses. It carries the "Top-Down Doom-like" subtitle itself, so
the start screen hides its text heading while the logo is up. It has a
transparent background with a soft glow, made to sit on the dark menu panel.

## Assets

The raw art and sound are not in this repository. The sprites, pickup icons
and sound effects are third-party assets (see [`NOTICE.md`](NOTICE.md)), and
what is committed is a handful of **packs** holding them:

| Pack | Holds |
|------|-------|
| `sprites/player.pak` | The marine's atlas |
| `sprites/enemies.pak` | The atlases of the characters the bestiary wears |
| `sprites/enemies-extra.pak` | The rest of the enemy collection, fetched only on demand |
| `sprites/items.pak` | The pickup icons |
| `sounds/sounds.pak` | Every sound effect the game plays |

The packs are built by `tools/pack_assets.py` from the raw PNG and WAV files
that the build tools (`tools/build_*.py`) produce from the original packs.
Those raw files are git-ignored; each build tool repacks its own group when it
finishes, or run the packer yourself:

```bash
python tools/pack_assets.py            # every pack
python tools/pack_assets.py sounds     # or one group: player, items, enemies, sounds
```

Each pack is an index plus its files' bytes, scrambled with a keystream so it
is not recognisable as PNG or WAV and cannot be previewed or saved file by
file. This exists only to discourage casual extraction; it is not security,
and the key is in `js/asset-pack.js` for anyone who looks. Packing is
deterministic, so rebuilding unchanged files changes nothing for git, and
`test/asset-pack.test.mjs` checks that the Python packer and the JavaScript
decoder agree byte for byte. The JSON manifests beside the packs hold layout
data only and stay plain.

`js/asset-pack.js` downloads each pack once and hands the rest of the game
ordinary `Image` elements (through object URLs) and audio bytes for
`decodeAudioData`, so nothing else knows the packs exist. A missing or damaged
pack is logged once and its contents fall back -- shapes for characters,
lettered badges for pickups, silence for sounds -- and the game still starts.

## Items, Drops and Secrets

Ammunition and weapons reach the player three ways, all of them Doom's.

**Laid out with the level.** Every room but the player's own rolls for one or
two ammo pickups when the map is built: clips and shells everywhere, boxes now
and then, rockets from level 4 and cells from level 6. Weapons and medikits are
placed by the generator as before. Nothing appears mid-level; the timer that
used to sprinkle items into a fight is gone.

**Dropped by the dead.** The four human zombies drop what they carried, at half
its usual load, exactly as in Doom: a Zombieman or SS trooper a half clip, a
Shotgun Guy a shotgun with four shells, a Chaingunner a chaingun with ten
rounds. Demons drop nothing. A dropped weapon is a pickup that lands where the
body fell (`WeaponPack` in `js/weapons.js`) -- it used to be written into the
map, which silently failed whenever the body fell on a prop, a pool or another
item. A weapon already owned is taken for its ammo, and left on the floor if
that ammo is full. The mini-boss leaves its rocket launcher the same way.

On the easiest skill every ammo pickup is worth double, as on Doom's *I'm Too
Young To Die*.

**Hidden in secrets.** Five to eight secrets a level, every one stocked, and
one of them the prize. The prize secret is chosen at random once the level's
secrets are placed, and it alone grows into a suite: a second chamber behind
the first whenever there is rock for it, and a 40% chance of a third, each
behind a doorway in the shared wall. It holds:

- a **weapon one tier early** -- the next rung of the ladder above what the
  level places in the open (a shotgun on level 1, a chaingun on level 3, the
  plasma gun before level 7, the BFG before 12), at the far end;
- a **soulsphere** (+100 health, up to 200 -- the only way past a full bar)
  or a **backpack** (doubles every ammo ceiling, with a clip of everything),
  from level 3 possibly a **MegaArmor**, from level 8 possibly a
  **megasphere** (health to 200 and a MegaArmor), or now and then just a
  medikit -- see the odds under [Armour](#armour);
- a **box of ammo** per chamber, and a second medikit at three chambers.

The other secrets are a single chamber with a small bonus: usually one pickup
(a clip, some shells, a medikit or, from level 2, now and then a green
armour), sometimes a box of ammo with a medikit beside it -- never a weapon,
never a sphere, never the MegaArmor. Finding five secrets on a level is
one big find and four small ones. The powerups' pickup sound is Doom's own.
`test/pickups.test.mjs` generates real levels and checks that every level has
exactly one prize secret, that the minor ones stay minor, and that every
chamber is reachable from the start.

### Armour

Doom's armour, with Doom's numbers (`ARMOR` in `js/constants.js`). The player
carries armour points, 0-200, and a class: green armour (class 1) takes a
third of every hit and the blue MegaArmor (class 2) half, out of the points
rather than health. The rule is P_DamageMobj's, applied in `Player.takeDamage()`
after the easiest skill's halving:

    saved = class 1 ? floor(damage / 3) : floor(damage / 2)
    if armour <= saved: saved = armour, and the class drops to none
    armour -= saved;  damage -= saved

Every hit goes through it: monster bullets, claws and fireballs, rockets and
barrels. Hazardous floors do too, as in Doom, which routes nukage through the
same function. Here a floor's damage arrives a fraction of a point per frame,
and a third of one point rounds down to nothing, so for floors the stream is
split exactly at the class's ratio and the armour's part is spent a whole point
at a time (`Player.absorbStreamedDamage()`) -- Doom's rule without the
rounding. God mode and invulnerability turn a hit away before the armour is
touched.

| Pickup | Effect | Refused when |
|--------|--------|--------------|
| Green armour | Armour set to 100, class 1 | Armour is already 100 or more |
| MegaArmor (blue) | Armour set to 200, class 2 | Armour is already 200 |
| Armour bonus | +1, up to 200; class 1 if there was none | Never: always taken, as in Doom |
| Megasphere | Health to 200 and a MegaArmor | Health and armour both already 200 |

A pickup *sets* the points rather than adding to them, so a green armour found
while wearing 60 points of blue is taken and swaps the blue for green -- which
is what Doom does. Armour lives on the Player, so it carries from level to
level like health and weapons, and a new game starts with none. Taking armour
plays Doom's item blip and counts on the level tally; it posts no message,
like every other pickup here.

Placement follows Doom's maps (`placeLevelArmor()` in `js/game-state.js` and
the secret stocking in `js/map-generator.js`):

- **Green armour** in the open on every level 1 and on 60% of levels after,
  plus now and then in a minor secret from level 2.
- **Armour bonuses** in one to three short rows of three to five, across a
  room -- a point each, worth following rather than worth a detour.
- **MegaArmor** in the open only from level 6, on 15% of levels; otherwise it
  is a prize-secret find from level 3. The prize secret's draw is soulsphere
  50% / backpack 35% / medikit 15% on levels 1-2; soulsphere 35% / backpack
  25% / MegaArmor 25% / medikit 15% on levels 3-7; and from level 8 the
  megasphere takes 15% of the soulsphere's share.
- Never in the player's starting room, and never on or beside the start square.

There is no armour artwork in the sprite pack, so the pickups are drawn in code
(`ArmorPickup` in `js/weapons.js`): a vest in green or blue on a faint pool of
its own colour, and the bonus as a small helmet flickering between the two, as
Doom's bonus cycles its colours. The status bar's ARMOR readout is green or
blue for the class worn and dimmed with none (see [Status Bar](#status-bar)).

## Audio

The sound effects are Doom's: **[Doom Sound Bulb](https://www.moddb.com/games/doom/addons/doom-sound-bulb-re-uploaded)** by SoundBulb, a
remaster of the 1993 sound set and the successor to Per Kristian's sound pack,
under Doom's own lump names, together with its Extras,
which give each monster a pain and idle voice of its own where Doom made several
share one and add the sounds Doom never had (a real chaingun, the Mancubus's
shot, the Arch-vile's raise, two more barrel explosions). They are extracted
from the pack's WAD and PK3 into `sounds/` by `tools/build_sounds.py` (see
`sounds/README.md` for provenance), bundled into `sounds/sounds.pak` (see
[Assets](#assets)), and fetched and decoded at page load, so they are in
memory before the first shot.

They are used the way Doom uses them, economies included:

- **Weapons.** The shotgun's pump plays 0.55s after the shot, during the
  reload. The punch plays only when the knife connects; the swing borrows the
  Revenant's whoosh (Doom's fist is silent until it lands). Barrels pick one of
  three explosions so a chain of them is not the same sound three times.
- **Monsters.** Each of the eighteen has its own sight, pain, idle, attack and
  death voices; the three zombies share one, as do the Demon and Spectre,
  because in Doom they are the same creature. The Mancubus bellows before its
  volley and the Arch-vile's flame ignites before it lands. The Cyberdemon's
  hoof and metal, the Spider's metal and the Arachnotron's clatter play as they
  walk. Monsters' guns are the player's samples: a Shotgun Guy sounds exactly
  like the shotgun, the Chaingunner and Spider like the chaingun.
- **Placement.** Everything that happens somewhere in the world is positioned
  with Doom's model: full volume within 200 map units, silent beyond 1200,
  linear between, panned by horizontal offset but never fully to one side.
  A monster two rooms away is inaudible until a door opens. The exception is
  Doom's own: the Cyberdemon's and Spider Mastermind's sight and death cries
  play at full volume from nowhere in particular, so the whole map hears them.
- **Pitch.** Weapons and monsters drift a few percent per play, as Doom v1.1
  did, so rapid fire is not one looped sample. Doors, switches and menus never
  drift: they are machines and sound like the same machine every time.
- **Menus are silent.** The start screen, the instructions, the pause menu,
  the level tally and Game Over make no sound, and nothing behind them is
  heard: as one opens the game is faded out in about a tenth of a second,
  nothing new may start, and whatever was still ringing is cut off rather
  than left to resume mid-way. The sound comes back when play starts or
  resumes. This is a separate hold from the player's own mute, which it never
  overrides. (The menu buttons used to tick and click with Doom's menu
  sounds, the tally opened on the exit switch, and Game Over came in with the
  marine's death cry; the cry now plays as he falls, as in Doom.)
- **Doors.** A locked door is the "no way" grunt.

Two sounds Doom never had remain synthesised in `js/audio-engine.js`, kept
quiet: the click of a dry weapon and the low-health heartbeat. The marine is
silent underfoot, as in Doom.

### Modules

`js/audio-engine.js` owns the mix: a saturation and compression bus, a
generated stone-room reverb kept almost dry, ducking under explosions, a voice
budget (28, hard ceiling 56 with priority sounds) so a firefight cannot spawn
unbounded nodes, sample loading and playback, and the synthesis primitives.
`js/audio-system.js` decides what each game event sounds like: the lump table,
the monster voices (`MONSTER_VOICES`, keyed by the `sounds` field in
`js/monsters.js`), and the placement maths.

### Auditioning and tuning

```bash
python -m http.server 8000   # then open http://localhost:8000/tools/sound-lab.html
```

The sound lab plays every sound on demand, has a row per monster voice with a
button per role, a listener slider to hear the panning and falloff, the live
voice count, and a firefight stress test. Reassigning a sound means editing the
lump name in `js/audio-system.js`; adding one means naming it in `SAMPLE_NAMES`
and re-running the build tool, which reads that list and repacks
`sounds/sounds.pak`:

```bash
python tools/build_sounds.py --source "<folder holding the .wad and .pk3>" --clean
```

The audio test suite fails on any lump missing from the pack, and anything in
the pack nothing plays.

## Testing

`node test/run.mjs` runs thirty-two suites via `test/run.mjs`, each in its own process (they
install conflicting DOM stubs). They stub the DOM and Canvas so the real game
modules can be driven in Node. Suites that inspect the art and sound read it
out of the committed packs (through `test/pack-files.mjs`), so the suite passes
in a fresh clone that has no raw PNG or WAV files.

| Suite | Covers |
|-------|--------|
| `test/smoke.mjs` | Gameplay: thousands of frames across many levels, no exceptions or NaN state, bounded entity arrays, pickups and doors on contact, bosses sealing the exit, enemies dying exactly once |
| `test/level-layout.test.mjs` | Hundreds of generated levels: every key load-bearing (removing any one must strand the player), keys and exit in the zones the progression assigned them, doors as matched pairs spanning their corridor, every non-room tile part of a two-wide passage, zone rectangles in bounds and disjoint, and every gate a change of look with terrain following its zone's theme |
| `test/lighting.test.mjs` | Cone and glow shape, wall and door shadows, aim responsiveness, explored memory, and a per-frame cost budget |
| `test/render.test.mjs` | The real render pipeline against a recording canvas: offscreen layers, mask compositing, memory pass, extreme zoom |
| `test/terrain.test.mjs` | The terrain table and its accessors; the neighbour mask that drives autotiling; that generated levels grow pools and that a hazard is never the only way through; damage rates quoted per second landing correctly per frame; the terrain-light budget |
| `test/stability.test.mjs` | The lit area must change smoothly: turning and walking may not make any tile jump abruptly, and the ray grid must not follow the player's aim |
| `test/visibility.test.mjs` | Property test over real generated levels: every wall the player can see must be lit and every wall it cannot must stay dark, both checked against an independent ray-marched reference |
| `test/enemy-sprites.test.mjs` | Every atlas in the manifest is in the enemy packs and every animation resolves to in-bounds frames; the enemy animation state machine, death/corpse phase, and the no-artwork fallback |
| `test/hitbox.test.mjs` | Segment-versus-shape geometry at its edges; that a monster's hit box covers its drawn body and the player's circle covers the artwork; that a bullet faster than a target is wide still hits, that a bullet crossing two monsters hits the nearer, that a bullet dying on a wall still counts the monster it crossed, and that a rocket detonates once; hitscan against bodies; melee reach to the body; blood on a hit |
| `test/particles.test.mjs` | Lava embers and sparks, sludge bubbles and gas, water glints; quiet pools out of range; splashes on entering a pool and ripples while wading, for monsters too; blood amount, direction and settling into stains; the particle and decal caps; drawing on the render path's canvas |
| `test/doors.test.mjs` | A door pair registers as one door; locked doors block the player with or without the key until touched; touching with the key unlocks it and it slides open; it opens for whoever approaches, monsters included once unlocked, waits, shuts, and never shuts on an occupant; sight, light, bullets and movement all agree about a shut, sliding and open door; open and close sounds fire once each |
| `test/decor.test.mjs` | Every room kind furnishes without cutting anything off: all floor stays reachable, no prop within a tile of a doorway or an item, solids capped per room, props only inside rooms; glowing props produce lights and the runtime budget holds; generated levels still verify furnished |
| `test/barrels.test.mjs` | Barrels stand only against room walls clear of doors and items, never on level one; a barrel blocks the player and monsters, stops bullets, hitscan and melee, goes off after its fuse, hurts what is near it, wakes monsters, and sets off the barrel beside it |
| `test/sectors.test.mjs` | A room is one flat sector level, corridors run darker, light spills through a doorway, a wall takes the floor's light, room kind biases it, each special swings the way Doom's does, and ambient stays gated on line of sight rather than on facing |
| `test/windows.test.mjs` | A window stops a body and not a shot or a line of sight; interior and exterior are told apart by what is behind; shots and fireballs cross while the player and monsters cannot; daylight lights the floor beneath one; runs are cut only into plain masonry and leave the level exactly as solvable |
| `test/arsenal.test.mjs` | Every weapon's dice, rate, spread, speed and ammo pool are Doom's; the pistol and rifle share bullets and the BFG spends forty cells; a pistol bullet lands the instant it is fired, dead straight on the first shot and spread on refire; a shell is seven pellets; a wall stops a bullet and a bullet throws a switch; the rifle fires a round every 4 tics; the blast falls off to the edge, needs sight, and hurts the shooter in full; a rocket does impact damage then blast; the BFG sprays forty rays from the player's position over the monsters in front and none behind; a punch is 2-20 |
| `test/switches.test.mjs` | An alcove is sealed and its switch is on another wall; the level verifies with it; pushing into or shooting the switch presses it once; the wall slides over its frames and only then lets bodies, sight and light through; a closet on a switch opens when pressed and not when walked past |
| `test/traps.test.mjs` | Closets only in solid, unreserved rock with a rock margin, never in the start room, none on level 1; a planned level still verifies and still verifies with every closet opened; dormant monsters are invisible, unhittable and still until the trigger is crossed, then the wall opens and they hunt; teleport ambushes arrive in the room, out of reach, and each trap fires once |
| `test/monsters.test.mjs` | The Doom roster names real artwork and the spawn tables only hand out real monsters; P_CheckMissileRange and P_NewChaseDir at their edge cases; and on a live level: waking by sight and by sound (round walls, not through them), eight-direction chasing, monsters not walking through each other, hitscan and melee landing, pain interrupting attacks, infighting and the threshold rule, the Pain Elemental's Lost Souls and their cap, the Arch-vile raising the dead, the bosses, and Shift to run |
| `test/player-sprites.test.mjs` | The player atlas, read from its pack, and every per-weapon animation; that each weapon names an animation set and an icon that are packed; the attack-animation hold; the no-artwork fallback |
| `test/audio.test.mjs` | The sound set is complete (every lump named is in the sound pack and everything packed is played, every monster has a voice, every voice names real lumps) and decodes; every weapon and monster role plays its Doom lump; Doom's panning and distance falloff, with the full-volume boss exception; silence rather than exceptions with no Web Audio or before samples arrive; cooldowns and the voice budget under a firefight |
| `test/pickups.test.mjs` | Doom's drops (a half clip from the zombies, a shotgun from the Shotgun Guy, a chaingun from the Chaingunner, nothing from demons) landing as pickups where the body fell; taking a dropped weapon, and leaving it when its ammo is full; soulsphere and backpack; ammo laid out with the level and never on the start square; every chamber of every secret suite reachable and stocked with a weapon a tier early, a prize (a sphere, backpack, MegaArmor or medikit) and ammo, and the MegaArmor never in a minor secret |
| `test/level-summary.test.mjs` | The level tally: a fresh level starts zeroed with its secret doors counted; kills, secrets and pickups are counted as they happen and a pack left on the floor is not; clearing the level shows the tally with the right rows and waits, continuing starts a fresh level and keeps the run's totals, Game Over shows the run including the unfinished level, and a continue over a dead player is refused |
| `test/preloader.test.mjs` | The loading screen: an image counts only once drawable and a broken one never hangs; failed loads count as done; atlases a manifest names are waited for too; a lost request is abandoned after a stall and slow ones at an overall deadline; pack downloads counted by their bytes, the bar never running backwards as sizes arrive, and bytes still arriving holding off the stall; the player, roster and icon preloads decoded out of the packs; and GameController refusing to start a level, and keeping the start menu hidden, until loading is over -- including when an atlas in a pack is damaged or the packs are missing |
| `test/cheats.test.mjs` | The cheat matcher: every code, either case, the IDCLEV digits and IDBEHOLD letters, a wrong key restarting the sequence, keys ignored that are not characters, and which keys a code claims from play (not the "d" of a stray "id"); and each code's effect on a live game -- god mode and invulnerability stopping every damage source, no-clipping separate from both, the arsenal and keys, every power-up toggling and doing its job, the map cheat cycling, the warp, and Doom's replies on the message line |
| `test/armor.test.mjs` | Doom's armour: green taking a third and blue half of a hit, rounded down, the skill's halving first, the class dropping with the last point; monster hits and hazardous floors absorbed alike; god mode and invulnerability touching none of it; green refused at 100 or more and blue at 200, the bonus always taken and capped at 200, the megasphere; every pickup counted on the tally; armour carried between levels and gone in a new game; IDKFA and IDFA giving 200 of blue; generated levels with green from level 1, bonuses in rows, the MegaArmor late or in the prize secret, never on or beside the start; the HUD readout and its colour; each hit remembered, with its source, for the status bar's face |
| `test/pause.test.mjs` | The pause menu: Esc pausing and resuming, closing the code box without resuming, and doing nothing on the start screen, tally or Game Over; held keys, the mouse button and the touch sticks let go on pause; the level not advancing while paused; silence on pause and on every menu, ringing sounds cut, the player's mute surviving a resume; fullscreen through the standard and webkit APIs, its controls hidden where unsupported, and the browser's Esc out of fullscreen neither pausing nor resuming |
| `test/hud.test.mjs` | The status bar: Doom's five health tiers for the face; a hit's side measured on screen; the face's priorities (dead, grin, ouch, hurt, rampage, god, idle) and each expression letting go on time; AMMO as the pool in hand and a dash for the knife; every readout, ARMS slot, key and ammo-table row written from a player; hits looking towards their source, a big one an ouch, a new gun a grin, a held trigger the rampage face; pulses on gains and losses but not on a shot spent; a new game starting clean; unchanged numbers left alone |
| `test/asset-pack.test.mjs` | The asset packs: pack-then-unpack identical at every awkward length; no PNG or RIFF/WAVE signature or entry name surviving scrambling; truncated, padded, wrong-version and damaged packs failing cleanly, and a damaged entry failing alone; every committed pack reading, passing its checksums and re-encoding to the identical file, with the enemy packs split along the roster and, in a working checkout, matching the raw build output; the loader sharing one download, reporting streamed bytes against the pack's declared size, and resolving a missing or damaged pack to nothing rather than throwing |
| `test/gamepad.test.mjs` | Game controllers: presses fire once and menu directions repeat when held; stick drift inside the radial dead zones reads as nothing; the left stick moving at walking pace, LT running and walking under Always Run, the right stick aiming and RT firing, facing the way he walks with the aim at rest, the mouse keeping its aim once it moves; weapons, zoom and the map; rumble on a hit and not under god mode; Start pausing and letting go of everything, B and Start resuming, a lost controller pausing; menus stepped through, wrapped and pressed, A pressing the main button, the instructions scrolled and closed |

## Tech Stack

- **Rendering:** HTML5 Canvas
- **Language:** Vanilla JavaScript (ES modules)
- **Audio:** Web Audio API playing Doom Sound Bulb (SoundBulb), plus a little synthesis; no library
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) (CDN)
- **Fonts:** Press Start 2P for the menus and canvas, Oxanium for the status bar (Google Fonts CDN)
- **Server:** none of its own; any static web server will do
- **Sprites:** Player, enemy and pickup art in scrambled packs (`sprites/*.pak`) beside their manifests (`sprites/*/manifest.json`); see [Assets](#assets)

> **Note:** Tailwind CSS and the Google Fonts are loaded from CDNs, so the game looks best online; audio and gameplay do not need the network.

## License

TDDL's code is free software under the **GNU General Public License, version 2
or (at your option) any later version** -- see [`LICENSE`](LICENSE). Parts of
the monster AI, the monster table and the cheat replies are ported from id
Software's *DOOM* source code, which id released under GPL version 2, so the
game as a whole is distributed under GPL version 2.

The licence does not cover the sound effects, the sprites and pickup icons
(CraftPix assets, used under the CraftPix licence) or the TDDL logo, which
remain the property of their respective owners. The asset packs contain those
same sound effects, sprites and icons. [`NOTICE.md`](NOTICE.md) lists
every third-party asset and its source, along with the credits for id
Software's code and the fonts.

DOOM is a registered trademark of id Software LLC. TDDL is an unofficial fan
project, not affiliated with or endorsed by id Software, ZeniMax Media,
Bethesda Softworks or Microsoft.
