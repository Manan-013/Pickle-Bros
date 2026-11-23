# PickleBros — 3D Online Pickleball (Browser)

## Decisions
- **Platform:** Browser game (desktop + mobile), no install, join via link.
- **Game modes:** Singles (1v1) and Doubles (2v2), each playable vs Computer and Online with friends.
- **Controls:** Arcade auto-swing + shot type selection. *(default, can change)*

## Game modes
|  | vs Computer | Online with friends |
|---|---|---|
| **Singles (1v1)** | You vs AI | You vs friend |
| **Doubles (2v2)** | You + AI partner vs 2 AI | Up to 4 friends; empty slots filled by AI |

- **AI difficulty:** Easy / Medium / Hard.
- **Online rooms:** host creates a private room and shares a 6-letter code or invite link;
  host picks Singles/Doubles, players pick a team slot, host starts when ready.
- **Mixed online doubles:** e.g. 2 friends vs 2 AI, or you + friend vs friend + AI.
- If a player disconnects mid-match, AI takes over their slot until they rejoin.
- Quick match with strangers is optional, later (Phase 6).

## Tech stack
| Layer | Choice |
|---|---|
| Language / build | TypeScript + Vite |
| Rendering | Three.js (GLTFLoader + Draco/meshopt) |
| Ball physics | Custom deterministic sim (gravity, drag, spin, bounce), shared by client & server |
| Multiplayer | Node.js + Colyseus, server-authoritative ball & rules |
| Hosting | Client: Vercel/Netlify · Server: Fly.io/Render |

## Project layout (monorepo)
```
PickleBros/
  client/     Vite + Three.js game (rendering, input, UI)
  server/     Colyseus game server (rooms, authoritative sim)
  shared/     Physics, rules, constants used by both
  assets/     Optimized models, textures, sounds
  raw-assets/ Original heavy models (not shipped)
```

## Gameplay
- Court: regulation 20 ft x 44 ft, 7 ft kitchen, net 36 in sides / 34 in center.
- Rules: underhand diagonal serve, two-bounce rule, no volleys in kitchen,
  side-out scoring to 11, win by 2.
- Controls (kept deliberately small):
  | Action | Control |
  |---|---|
  | Move | WASD (or arrows) |
  | Aim | Mouse — crosshair on the far court |
  | Normal hit (dink / drive) | **Left-click**; where you aim picks it: short (kitchen) = dink, deep = drive |
  | Power hit (lob / smash) | **Right-click**: lob, or smash if the ball is above head height |
  | Hit timing | Menu setting: **Mouse clicks** (time each click; 0.3 s window) or **Auto swing** (hits by itself; hold right button for lob/smash) |
  | Serve | Left-click, aimed inside the service box |
  | Charge | Hold the click: tap = soft touch, ~0.7 s = full power (more topspin), longer = OVERHIT (wild) |
  | Timing ring | Ring on the court closes in around you; release while it's green |
  | Spin | Flick the mouse while holding: up = topspin, down = slice, sideways = curve |
  | Dive | Space (toward your movement, or toward the ball) — 3 m lunge, then a short recovery |
  | Let a ball go | Shift (optional, auto swing only) |
  Contact quality adds scatter. Mobile: joystick + drag-to-aim + lob/hit buttons (to build).
  Power Mode specials should follow the same idea: one Special key (E) + aim, not motion combos.

## Camera
| Camera | Where used | Notes |
|---|---|---|
| **Third person (default)** | All matches | Behind & above own player, follows player, leans toward ball. Online: each player always sees from their own end. |
| **First person (optional)** | Classic Mode matches, mini-games | Toggle in settings / pause menu. Not allowed in Power Mode online (fairness + supers need to be seen). |
| **Super cinematic** | Supers | 1–1.5 s dramatic angle, then snaps back. |
| **Broadcast / replay** | Highlights, spectators | TV-style side & sky angles. |

### First-person aids (to make it playable)
- **Landing marker:** ring on the court where the ball will bounce, shrinking as it gets close.
- **Ball shadow** always drawn, plus a soft glow outline so the ball is visible against any background.
- **Wide FOV** (~100°, adjustable) and **auto-turn**: the view gently follows the ball so it doesn't leave the screen.
- **Edge arrow** when the ball is off-screen (lobs overhead).
- **Kitchen warning:** screen edge flashes when your feet are on/near the kitchen line.
- **Partner indicator** (doubles): small icon showing where your partner is.
- **Comfort options:** reduce head bob, camera smoothing, FOV slider — to avoid motion sickness.
- Visible paddle + arms; swing animation plays in view.
- Mobile: first person available but off by default.

## Power System (fighting-game style)
Two rule sets, chosen per match: **Power Mode** (default, all below) and **Classic Mode** (pure pickleball).

### Power meter
- 3-bar meter per player, shown under each player's name.
- Fills from: perfect-timed hits, long rallies, winning kitchen dink battles, blocking specials.
- Lost on: faults, getting hit by a smash, whiffing a special.

### Timing & combos
- Each hit is rated **Perfect / Good / Late**, based on swing timing. Perfect = more speed, accuracy, meter.
- **Rally combo counter:** consecutive Perfect hits build a chain (x2, x3, ...) that boosts ball speed
  and meter gain. Breaks on a non-Perfect hit.
- **Command inputs:** direction motions + shot button, e.g.
  - `↓ ↘ → + Smash` — special smash
  - `← → + Drive` — curve drive
  - `↓ ↓ + Dink` — trick dink
  - Mobile: swipe gestures + on-screen buttons; optional "simple input" (one button per special).

### Special shots (cost 1 bar)
| Special | Effect | Counter |
|---|---|---|
| **Fire Smash** | Very fast flaming smash, knockback on contact | Perfect-timed block |
| **Curve Drive** | Ball bends sideways mid-flight | Read the curve, move early |
| **Phantom Dink** | Ball turns invisible for a moment, drops short | Watch the shadow |
| **Freeze Lob** | Slows opponent movement briefly if they misjudge it | Get under it fast |
| **Thunder Serve** | Fast zig-zag serve (only special allowed on serve) | Perfect return |

### Super moves (cost 3 bars)
- Each character has **one unique super** with a short cinematic camera (~1.5 s, game slows, not pauses).
  Examples: Meteor Smash (ball drops from sky), Clone Rally (3 fake balls, 1 real), Earthquake Bounce.
- Every super has a counter window — a Perfect block reflects it back and steals 1 bar.

### Defence
- **Perfect Block / Parry:** hit exactly on time to neutralize any special and gain meter.
- **Dive:** last-second lunge for far balls (recovery time after).

### Doubles extras
- **Team Combo:** both partners hit Perfect shots in a row → shared bonus meter.
- **Tag Super:** both partners spend 2 bars each for a joint super.

### Characters
- Each has stats (Speed / Power / Control / Reach), 2 specials and 1 super, so picks feel different.
- Starting roster of ~6 archetypes: Speedster, Power Hitter, Trickster, Wall (defence), All-rounder, Wildcard.

### Fairness rules
- Specials still obey pickleball rules (kitchen, two-bounce); no specials on serve except Thunder Serve.
- Every special has a readable tell (glow + sound) and a counter.
- Short cooldown between specials; supers once per game unless meter refills.
- Online: specials, timing ratings and meter are decided by the server; effects are visual only on clients.

## Phases
1. ✅ **Court & ball** — scene, lighting, court, net, ball sim (drag, spin, bounce, net/net-cord), shot solver,
   follow camera, landing marker. Offline ball-machine practice with streak scoring.
2. ✅ **Player & shots** — contact quality (Perfect/Good/Stretch → accuracy, pace, net risk), auto-swing at
   closest approach, Shift to let a ball go; shared rules engine & referee (singles + doubles, side-out scoring,
   0-0-2 start, server 1/2, diagonal serve boxes, two-bounce rule, kitchen volley + momentum, win by 2);
   menu, scoreboard, game-over screen; basic CPU opponent/partner (replaced in Phase 3).
2b. ✅ **Power system** (`shared/src/sim/power.ts`, in the shared engine so it works online) — 3-bar meter
   (clean hits, combos, long rallies, blocks, winning points), PERFECT-hit combos (faster shots),
   E arms a special decided by your shot: Fire Smash / Curve Drive / Phantom Dink / Freeze Lob, or
   Thunder Serve on a serve; Q arms the super Meteor Smash (slow motion). Specials are harder to
   return; a clean (≥0.8) return blocks them and earns a bar. 2 s cooldown. CPUs earn, spend (mostly on
   attacks) and block. Glow/colour per special, phantom ghosting, frozen tint, callouts, screen shake.
   Menu / lobby switch: Power ⚡ or Classic. *Not in Practice mode yet; one super for everyone until
   characters exist.*
3. ✅ **Vs Computer** — shared AI (`shared/src/ai.ts`) with Easy / Medium / Hard (menu picker, remembered):
   deep return then move up, third-shot drop, crosscourt dinks, attacks balls above net height, smashes,
   volleys at the kitchen line, aims at gaps/feet, lobs net-rushers, lets out-balls go; doubles partners
   hold their halves and the closer player takes the ball. Rally pressure ends very long rallies.
   Your partner plays at least Medium. Auto swing won't volley from inside the kitchen.
   *Still to do once Power Mode exists: AI using specials & blocks.*
4. ✅ **Online with friends** — `server/` (Node + `ws`; plain WebSocket instead of Colyseus — simpler for
   2–4 player rooms). Headless match engine in `shared/src/sim` runs on the server (ball, rules, score,
   CPUs) and offline in the browser. Create room → 6-letter code / invite link (`?room=CODE`), lobby
   with seats per team, host picks singles/doubles + CPU level, empty seats = CPU, host starts/rematches.
   Each browser moves its own player (instant feel; server clamps to court/speed); others + ball are
   interpolated 100 ms behind from ~30 Hz snapshots. Far-team players see the court from their end.
   Disconnect → CPU takes over; rejoin within 2 min (refresh-safe) gets the seat back.
   Public games: rooms can be Private (code/link) or Public (host can switch); a public games list
   (refreshes every 3 s) with Join/Watch; Quick match joins an open public room of your format or
   opens a new public one.
   Run: `npm run server` + `npm run dev` (or `npm run dev:lan -w client` for friends on the same Wi-Fi).
   *Still to do: deploy the server (Fly.io/Render) so friends can join over the internet; touch controls.*
   ✅ **Sound** (`client/src/audio/sound.ts`) — all synthesized with Web Audio (no files): paddle hits by
   shot, bounces, net, swings, point chimes, crowd murmur + cheers, a sound per special, block clang,
   combo blips, charge tone, timing-ring tick, game-over jingles, menu clicks; panned and distance-faded.
   Menu toggle + M to mute.
   ✅ **Characters (bobblehead style)** — `tools/build-characters.mjs` cuts each model's head at the neck,
   crops its texture to the face, simplifies to ~12K triangles (142 MB of models → 1.5 MB of heads in
   `client/public/characters/`). Cartoon bodies with running legs/knees, arm pump, swing, dive, idle
   breathing, celebrate/slump after points, spring-wobble bobblehead, team rings. Roster (`shared/src/
   characters.ts`): Rookie, Modi, Trump, Babita, Salman — small speed/power/control differences and a
   super each: Meteor Smash, Clone Rally (2 decoy balls), Blizzard (freezes opponents), Earthquake
   (skids low + stuns). Menu character select; CPUs get other characters; online lobby picker.
   ✅ **Courts** (`shared/src/arenas.ts` physics, `client/src/scene/arenaScene.ts` visuals) — Park;
   Beach (time-varying wind the aimer doesn't account for, sand: slower running, low bounces; palms,
   ocean, wind flags, wind indicator); Ice Rink (low grip = sliding, skidding bounces; boards, stands);
   Space Station (low gravity, less drag; stars, ringed planet, neon lines); Neon Rooftop (night city,
   neon court, visual only). Menu picker incl. Random; online host picks (Random re-rolls each match).
   ✅ **Venue** (`client/src/scene/venue.ts`) — instanced audience (~80–370 fans per court, bleachers or
   standing on sand) that sways and jumps/waves on points (bigger for long rallies, specials, game);
   referee on an umpire chair who watches the ball, signals (out / fault / point to winner) and calls
   the score aloud (browser speech voice); stadium scoreboard behind the court (+ high screen for the
   far end); TV-style on-screen score bug. Sound: crowd chatter (voice bands), clap-based applause with
   whoops, per-court ambience (birds, waves+gulls, arena hum, ship drone, city traffic).
   ✅ **Themed crowds & sea** — each court dresses its crowd: park caps; beach swimwear, sun hats,
   towels and striped umbrellas; ice jackets and beanies; space suits with glass helmets; rooftop dark
   outfits waving glow sticks. Referee hat matches the court. Beach sea is a shader (`scene/ocean.ts`):
   shallow-to-deep colour, swell, sun glints, shore foam, wet-sand slope and a sky dome.
5. **Characters & polish** — optional first-person camera with aids (landing marker, edge arrow, kitchen warning),
   optimized character models, unique specials/supers per character,
   animations (run, swing, special, super, celebrate), super cinematics, SFX, menus, replays.
6. **Expansion** — public quick match, ranking/ELO, cosmetics.

## Asset notes
- Current models are far too heavy for web (20–65 MB). Target < 5 MB each:
  Draco/meshopt compression, 1K–2K textures, reduced polycount (`gltf-transform`).
- `salman_khan_guide.stl` has no textures/rig — needs a rigged `.glb` version.
- Models resembling real public figures: OK for a private game; risky for a public or
  monetized release (likeness rights, store policies). Consider parody-styled or original characters.
- Characters need a common rig (e.g. Mixamo) so one animation set works for all.

## Performance targets
- 60 fps on mid-range laptops, 30+ fps on mobile.
- Initial download < 15 MB; characters lazy-loaded.
- Server tick 30 Hz; playable up to ~150 ms ping.
