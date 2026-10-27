# Shred World: extraction map (step 1)

Where the skateboard lives in `colinwillow/city` (Shred World) and what it becomes in Scene Companion.
Line numbers are `city/index.html` at commit **797e32b** (c192, a single 12,779-line file). If they have moved, grep for the symbol.

Most of what a board needs already exists from the Roller Girl pass: the `Skater` controller with its surface-frame physics,
vert lock, landings, grinds, flips, boost / stop / swivel, `FootIK`, `TrickScore`, `Surface`, `Rail` and the skate-kit prefabs.
**A board is a Skater with a deck under his feet**, so this map is mostly about what is different.

## Assets

| What | city path | Notes |
|---|---|---|
| The deck | `models/skateboard.glb` (52 KB) | 1 node `skateboard`, draco + webp; its length runs along local Z |
| Fun boxes | `models/ramps/skate_ramps_fun_boxes.glb` (139 KB) | 4 pieces `ramp_fun_box_01..04` (loaded at line 7162) |
| Riders | `models/colin.glb`, `models/chars/*` | Colin, moussa, alien, robot. His board clips (`skate_push_standing`, …) are on these rigs |

## Systems → Scene Companion

| System | city symbol (line) | What it does | Becomes | Gap |
|---|---|---|---|---|
| Board physics | `SK8` 542, `stepSkate` 11467 | Push, roll, steer, ollie, land | The existing `Skater`, with a `board` profile of numbers: shove 5.4, ollie 12.6, g 20, `top` 19, `roll` .065 | done: `Skater.presets.board` (step 2) |
| **The push clip is the clock** | `SK8.pushDur` / `pushFast` / `shoveDur` 542+ | Each shove fires on the clip's foot-on-road frame; the cycle shortens from a standstill (0.60 s) to cruising (1.55 s) and the clip is time-scaled to match | `Skater` push timing driven by a clip event (`push` frame events, like `foot`) instead of steady acceleration | frame events exist; the Skater needs a stroke mode |
| The deck | (deck pose ~3744) | The board under his feet, turned with him, tilted to the surface | **`Mount` on the feet** (the deck as a child entity), or a `Deck` behavior that places it between the soles every frame | done: `Deck` (step 2) |
| Deck tricks | `TRICK` 638 | **Pure geometry**: kickflip = a roll about the deck's Z (18 rad/s), shove-it = a yaw about Y (16 rad/s), varial = both; he holds the air pose | done: `DeckTricks` (step 3) | — |
| Body flips + barrel roll | `trickFlip` 10991, 10947 | Front / back flips and a barrel roll on the left flick, stretched to the air left; board flips trim the clip's landing tail | `Skater.startFlip` already does front / back / 360; add the barrel roll (about the forward axis) and the clip trim | none |
| Grinds on every box edge | 875 (comment), `stepGrind` 11446 | Every box's top edge is a rail, so the whole city is grindable with nothing placed | "Found ledges": a Solid's top edges offered to the Skater's `catchRail` | done: `Skater.ledges` + `walkShape().edges` (step 3) |
| Air bar roll / tricks scoring | `TRICK.land` / `bail` | A trick less than 80 % round on landing = a bail | `Skater` landing check + `TrickScore.lose` | none |
| Follow cam (board) | `CAM` 1491 | Board-only follow camera that swings behind after `idle` s | Camera entities (Stage 7) | Stage 7 |
| Blaster while riding | (`p.riding`) | Legs keep the board pose, upper body aims | `Melee`-style upper layer + a blaster behavior | the Zap blaster pass |
| High bar | `BAR` 878 | The gymnast bar (same as zap's HBAR) | `Bar` + `HighBar` — already built | — |

## Order for the next items

1. **Board mode**: a `board` preset for the Skater; the deck model mounted between the soles (`Deck`); the push clip as the clock.
2. **DeckTricks**: kickflip / 360 flip / shove-it on the right flick in the air, landed or bailed.
3. **Found ledges**: every Solid box's top edge is grindable.
4. A `skateboard` scene: Colin on the deck in the skatepark-kit, plus his fun boxes.
