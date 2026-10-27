# Roller Girl: extraction map (step 1)

Where Roller Girl's skating lives in `colinwillow/rollergirl` and what it becomes in Scene Companion.
Line numbers are `rollergirl/index.html` at commit **ccb860a** (r159, a single 17,897-line file). If they have moved, grep for the symbol.
No code has been moved yet. This is the plan for the next Roller Girl items in ROADMAP.md.

## Assets

| What | rollergirl path | Notes |
|---|---|---|
| The alien skater (the skin in use) | `models/alien_rollerskate_blue.glb` | 81 joints (65 Mixamo + a 15-bone tail), 49 clips named as a schema: `blade_<soft/medium/hard/casual>_<forward/backward>`, `idle_*`, `in_air`, `tuck`, `flip_pose`, flips, `fall_to_*` / `get_up_*`, `grind_left/right`, style skates |
| Roller girl (first skin) | `models/roller_girl.glb` | 66 joints, 6 clips; `skate_fwd` is 6 frames and plays out-and-back (ping-pong) |
| Zap's melee set | `models/melee_zap.glb` | nodes + 14 clips, no mesh (`npm run borrow`) |
| Building kit, props, city | `models/kit/`, `models/props/`, `models/wpcity/` | Copied from weirdport |

## Systems → Scene Companion behaviors

| System | rollergirl symbol (line) | What it does | Becomes | Engine gap it needs |
|---|---|---|---|---|
| Triangle floor collider | `TRI`, `triAdd` 1119, `groundAt` 1179 | Every up-facing triangle (up to ~83°) in a grid; "height + normal at x,z" | `runtime/trimesh.js` + a `Surface` behavior on any mesh (or a collision GLB's `ramp_` / `deck_` triangles) | **The big one.** Scene Companion has boxes and axis ramps only. Skating needs real curved transitions, so it needs a triangle collider. |
| Skating physics | `SK` 596, `stepGround` 15385 | Velocity in the SURFACE's frame: wheels roll along and edges bite across, so a half pipe is the flat at an angle. Grip-limited carve, rolling drag, slope gravity, push strokes on a half-sine. | `Skater` behavior (a second controller beside PlayerController, owning the body like `mover`) | The triangle collider; a body that tilts to the surface normal |
| Air, vert lock, landing | `stepAir` 15628, `leaveGround` 15179, `VERT` 15056, `vlipFind` 15233, `LAND` 800, `AIR` 746 | Pop along the travel, vert airs come back into the pipe and follow a curved coping. Landings are judged against the face; stance comes out of the landing. | Part of `Skater` | Lip finding over triangles (`lipEdges` 5525) |
| Stance / fakie / swivel | `setStance` 5249, `swivel` 15969 | Forward or fakie as a state, flipped by landings and reversals; a left tap swivels | Part of `Skater` | none |
| Grinds | `GRIND` 877, `railPath` 5061, `railCatch` 5206, `stepGrind` 5273, `grindDown` 5649 | Rails as polyline paths. Caught in the air (swept), or by a swipe-down dive; side clip from the approach. Sparks. | `Rail` behavior (path from child points / a mesh) + grind state in `Skater` | Rail data in scenes (a polyline field); the swipe gesture already exists (flick) |
| Rail network | `RAILNET` 5349, `railLink` 5442 | Joins ends, T-branches picked by the stick, auto connectors | `Rail` linking at load | none |
| Found ledges | `lipEdges` 5525 | Every box top or coping edge is grindable on a swipe | Later, after the triangle collider | trimesh |
| Flips / tricks | `FLIPP` 13886, `startFlip` 15980 | Procedural flips timed to the air left, `tuck` / `flip_pose` blended, an air pivot at the hips | `Tricks` behavior (lateUpdate rotation about the hips) | none (lateUpdate exists) |
| Boost / speed skate / stop | `BOOST` 15143, `SPEED` 15157, `STOP` 15127 | Flick-up boost with FX, held speed skate, skid stop and cut | Part of `Skater` | none |
| Move brain (animation) | `MOVES` 13940, `buildMoves` 13997, `girlAnimMoves` 14573 | Reads the clip naming schema into a table. Pushes ease from casual to hard by thumb drive; idles rotate; grabs, style skates, bails. | `SkaterAnimator` (like Animator, driven by `Skater` state) | Backward clips turned to face forward at load (`faceForward`); clip mirroring (`mirrorClip`) |
| Tail | `TAIL` 449, `tailWave` 14281 | Wave mode: each bone eases toward its parent at a rate falling root→tip | `Dynamics` gets a `wave` mode for `tail_*` chains | none (Dynamics + lateUpdate exist) |
| Feet on the ground | `FOOTIK` 312, `legIK` 16418 | Lowers the body until a sole touches; two-bone IK on the other foot; feet flat to the surface | `FootIK` behavior | none (`runtime/ik.js` exists) |
| Blade trails | `TRAIL` 13591, `trailStep` 13634 | Camera-facing ribbons off the soles and hands | A `Trail` VFX behavior | Stage 7 particles / VFX |
| Wall rides, surface loops | `WALL` 5781, `stepWall` 5799, `SURF` 5092 | Ride a tall face, loops as never-caught rails | Later | trimesh |
| Wing pack, blaster, melee | `WING` 417, `wingFly` 16997, `GUN` 374, `MELEE` 331 | Flight mode, a 3D aim, Zap's strikes | Later: Melee exists, Mount exists | — |
| Scoring | `SCORE` 16128, `trick()` 16144 | THPS combo multiplier | Reactions variables + a `Score` behavior | none |
| Ramp kit | `kitPiece` 2543, `KSZ` 1558, `docs/RAMP_KIT.md` | 40+ parametric pieces (QPs, pipes, bowls, banks, rails) in their own frames, exported with `fn_` names | Prefabs per piece (mesh + Surface + Rails); Colin's `handoff/` names already match | trimesh |
| Launchers, moving floors | `launchSolve` 8355, `DYN` 1170, `stepDyn` 10985 | Solved throws onto targets; platforms that carry her | `Launcher` behavior; MovingPlatform exists as Bob/ride | none |

## Order for the next items

1. **Triangle collider** (`runtime/trimesh.js`, built from any mesh or a collision GLB). PlayerController should walk on it too, so every game gets real slopes.
2. **Skater**: the ground step, air and landing. A half pipe and a bowl from the ramp kit as test pieces. Colin's alien skater as the character.
3. **SkaterAnimator** + backward clips turned to face forward + FootIK.
4. **Rail** + grinds (catch, dive, side, sparks), then the network.
5. **Tricks** (flips), boost / stop / swivel, the tail's wave mode, trails, scoring.
6. Then a `skatepark` scene built from her ramp kit as prefabs.

Her `npm run sim` cases (`tools/sim.mjs`) are the reference numbers to measure against: carve speed kept, pump peaks, vert air lands in the pipe.
