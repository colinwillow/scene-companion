# Colin's own models (not CC0 — his, fine to use in his projects)

| file | from | notes |
|---|---|---|
| characters/zap.glb | zap | hero, 62-joint Mixamo, draco + webp, 62 clips incl. `in_air` (fall), `front_flip`, `landing_soft/hard`, `take_damage_and_fall_down` |
| characters/xray_skeleton.glb | zap | ground enemy, 8 clips: standing idle/walk/run, hits, `Shoulder_Hit_And_Fall`, `Getting_Up` |
| characters/clancy.glb | zap | mutant brute, 37 clips: `mutant_*` idle/walk/run/dying, `jumping_up`, `falling_idle`, `hard_landing` |
| props/sp_rock0*.glb, sp_stone01.glb | plutopia | authored in cm — always use `height` |
| props/alien_rock_01.glb, alien_mushroom_01.glb | plutopia | unit-cube normalized Tripo shells |
| props/e_crates, e_rock_a, c_bench, c_dumpster, c_hydrant, c_lamp | culture_war | generated, metres, untextured vertex colour |

All Tripo/generated exports are `doubleSided`; the prefabs set `frontSide: true`.
The draco decoder is vendored in `vendor/draco/`.

Characters with a `*.character.json` (model + height + clip roles, see SKILL.md): `zap`, `skeleton` (xray_skeleton.glb), `mutant` (clancy.glb).
| characters/colin.glb | city (Shred World) | Colin himself, 68-joint Mixamo, draco + webp, 52 clips incl. the board set `skate_push_standing/crouch`, `skate_idol_standing/crouch`, `skate_ollie_init_air/air/landing` |
| props/skateboard.glb | city (Shred World) | one node `skateboard`, deck along local Z (node turned +90° about X, scale 0.01); the `Deck` behavior sizes it to its `length` |
