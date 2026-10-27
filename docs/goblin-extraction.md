# Goblin samurai — extraction map (step 1)

Where every piece of the ninja-goblin lives in `colinwillow/zap` today, and what it becomes in Scene Companion.
Line numbers are `zap/index.html` at commit **479d49e** (one 57k-line file; grep the symbol if lines have moved).
No code has been moved yet — this is the plan for steps 2 and 3+ in ROADMAP.md.

## Assets

| What | zap path | Notes |
|---|---|---|
| Goblin | `models/characters/goblin_game.glb` (forged bake: `models/characters/forged/goblin_game.glb`) | HERO table line 1040, key `goblin` |
| Alien goblin "KORAJIN GRUMBO" | `models/characters/alien_goblin_game.glb` (+ forged), `alien_goblin_chains.glb` | key `agoblin`; the chains file carries the CHAIN rig |
| Samurai (duel AI) | `models/characters/samurai_game.glb` | DUEL.md, the AI samurai (m985) |
| Katana | **built in code** (`katanaScene`, 12990) | No GLB. Step 2 must export one or port the builder into a prop factory |
| Source zip | `models/characters/goblin warrior.zip` | Original before Forge |

Forged bakes come from `FORGED` (30248) / `HERO_SUB` (57913): Mixamo clips baked onto his rig by the Forge, which Scene
Companion already serves at `/forge/`. Step 2 copies the forged GLB into `assets/models/colin/characters/` with a
`goblin.character.json` (roles: idle, walk, run, jump, fall, land, attack + the ninja set below).

## Systems → Scene Companion behaviors

| System | zap symbol (line) | What it does | Becomes | Engine gap it needs |
|---|---|---|---|---|
| Locomotion | `MOVE` 1068 | Walk/run/sprint blend by stick magnitude, jump, double jump | Existing `PlayerController` + Animator roles | none |
| Ninja gait | `NINJA` 20870 | Swaps run/jump clips to `run_fast` / `ninja_run` / `ninja_jump` | Role overrides in character.json (a "style" set) | none — roles already swap |
| Zoom spin-up | `ZOOM` 20879, `zoomGo` 20887; PARKOUR.md | Left-pad hold charges, release launches | `Zoom` behavior (input.holdLeft → impulse) | input: left-pad hold-in-place gesture |
| Wall run | `WRUN` 10543; `wrunFind/Tap/Go/End/Jump/Pose/Spawn/Clear` 10546–10632 | Find a wall beside him, run along it, jump off | `WallRun` behavior | `sweep`/`raycast` (done, runtime/collide.js); turned-box walls (obb shape done) |
| High bar | `HBAR` 10336, `hbarMake` 10342; `hbarSpawn/Reach/Catch/Fly/Palm/GripPt/Curl/Pose` 10722–10899 | Catch a bar, swing, release into a flip | `Bar` behavior on a prop + `Swing` on the player | hand IK to the grip point; post-animation hook |
| Vault | `VAULT` 18367; `vaultHips/Lift/Go` 18372–18393 | Vault low boxes at speed | `Vault` behavior | none beyond collide.js |
| Ledge | `LEDGE` 1280; `ledgeFind` 12192; `ledgeGo/At/Drop` 18776–18807 | Grab a lip, hang, pull up | `Ledge` behavior | ledge finder over Solid tops (collide.js overlap + box tops) |
| Climb | `CLIMB` 26384; `climbFind/Go/Off` 26464–26489 | Ladders | `Climb` behavior on a ladder prop | none |
| Cover | `WALL` 1192; COVER.md | Back to a wall, sneak | later — not goblin-critical | — |
| Katana combat | `KATANA` 17524 (lock cone 1.05, reach 3.5); `katStance/Style/RunTilt/LeftGrip/ChargePose/Parry` 17590–17724 | Lock-on, combo, air slam `katana_jump_attack`, parry, two-hand grip | Extend `Melee` (lock cone, combo list, air variant) + `Parry` | left-hand IK (`lgrip`); weapon on a named bone |
| Katana mount | `katanaMountL` 11343, `katTrim` 20998 | Parents the blade to a hand bone, trims clips | `Mount` behavior: prop → bone by name | **attach a prop to a named bone** |
| Charge | `CHARGE` 6154 | Hold-to-charge strike | `Melee` param `charge` | input hold |
| Duel AI | DUEL.md, samurai m985 | The AI swordsman | `Duelist` behavior (Chase + Melee + Parry) | none beyond the above |
| Hair / cape springs | `SPRINGS` 10679; `springsInit/Step` 10681/10701 | Bones `hair_N_M` / `cape_N_M`; hair {stiff 3.6, drag .32, grav .45, maxBend .9}, cape {stiff 1.1, drag .14, grav 1.6, maxBend 1.35}; sphere colliders on Hips, Spine1, Spine2, legs, head | `Dynamics` behavior (chains by bone-name prefix, params per chain) | **post-animation (lateUpdate) hook** |
| Chains | `CHAIN` 2973; `chainInit/Step/Write` 23994–24149 | Verlet, fixed substep (alien goblin's chains) | Same `Dynamics` behavior, `verlet` mode | lateUpdate hook |
| Tail | `TAIL` 10158, `tailSway` 10166 | Driven sway | `Dynamics` mode `sway` | lateUpdate hook |
| Stadium | arena world, z1 at 56603; menu 57110; SPAWN menu ~7390; white construct m966/m967 (9125/9147) | The sandbox the goblin plays in | `scenes/stadium.scene.json` (step 2) | none |

## Engine gaps to close first (in this order)

1. **Post-animation hook** — behaviors need a `lateUpdate(dt)` that runs after the mixer, for springs, chains, IK and
   aim twists. Without it every dynamic bone is overwritten by the next clip sample.
2. **Prop on a named bone** — a `Mount` behavior (or `entity.mount: { bone }`) so the katana rides `mixamorig_RightHand`.
3. **Two-bone / hand IK** — left-hand grip on the katana, palms on the high bar.
4. **Katana as a GLB** — export the code-built blade once (or a prop factory), so it is an asset in the library.
5. **Camera FOV / speed lines** — the zoom and the wall run sell speed with the lens; a camera-entity param.
6. **Left-pad hold gesture** — for the zoom charge (Colin's control map: left hold-in-place).

## Order for step 3+

Wall run → ledge → vault → katana (Mount + Melee lock/combo) → Dynamics (hair, cape) → high bar (needs IK) → zoom →
duel AI. Each one: a behavior, a test in `tests/`, and a demo spot in the stadium scene.

## Status (Oct 27 2026, build loop)

All of it is now a behavior, each with tests and a spot in `scenes/stadium.scene.json` (play.html?scene=./scenes/stadium.scene.json):

| zap system | Scene Companion | in the stadium |
|---|---|---|
| goblin / alien goblin rigs | `goblin.character.json`, `agoblin.character.json` | the player; Korajin |
| katana (code-built) | `assets/models/colin/props/katana.glb` (`tools/make-katana.mjs`) + `Mount` | both hold one |
| katLeftGrip | `HandGrip` (+ `runtime/ik.js` ik2) | both, in the stance clips |
| KATANA combat | `Melee` combo / lockOn / airClip+slam | the player's flick |
| SPRINGS / CHAIN | `Dynamics` (+ the `lateUpdate` hook) | Korajin's hair and cape |
| WRUN | `WallRun` | the wall-run lane (SW) |
| LEDGE | `Ledge` | the 2 m block (NW corner) |
| VAULT | `Vault` (tuck pose) | the 1 m block |
| HBAR | `Bar` + `HighBar` | the bar at (3, 2.55, 11) |
| ZOOM | `Zoom` + the sticks' hold gesture | left pad held / key C |
| AI samurai (DUEL.md) | `Duelist` — the readable core: stand-off, slowed wind-up, interrupt, guard, KO | Korajin |

Not ported: the duel's shield / shot / armour triangle, the bar hook (air flick onto the bar), climbing (`CLIMB`), cover, the
zoom's rings and dust. Engine gaps closed on the way: lateUpdate, bone mounts, two-bone IK, collision GLBs, turned-box walking,
the Euler read/write fixes (`setYaw` / `yawOf`).
