# Zap's blaster and DNA gun: extraction map (step 1)

Where the guns live in `colinwillow/zap` and what they become in Scene Companion.
Line numbers are `zap/index.html` at commit **479d49e** (a 58,014-line file). If they have moved, grep for the symbol.

What is already here: `zap.glb` + `zap.character.json` (his rig has `weapon_root_right` / `weapon_tip_2`), the `Mount`
behavior (a prop on a named bone, `unit` 0.01321 = zap's `WEAP.unit`), the sticks with tap / flick / hold, `Health`,
`world.raycast`, and now the `blast` event that `Breakables` / `KitParts` listen to. **What is missing is the gun itself.**

## Assets

| What | zap path | Notes |
|---|---|---|
| Blaster | `models/weapons/alien_antenna_blaster_game.glb` | built round `weapon_root_right`, tip (−14.3102, 0, 0): parents with identity (CLAUDE.md "FOUR WEAPON MOUNTS") |
| Launcher | `models/weapons/alien_launcher.glb` | same mount pair; fires `ROCKET` |
| Hammer | `models/weapons/alien_antenna_hammer_game.glb` | a melee weapon (`charge: true`) |
| Shoot / aim clips | on zap.glb: `idle_rifle`, `shoot`, `rifle_run(_shoot)` | the sighted pose is frame 0 of `shoot` (`aimFrom`) |

## Systems → Scene Companion

| System | zap symbol (line) | What it does | Becomes | Gap |
|---|---|---|---|---|
| Weapon slots | `WEAP.slots` 2215 | none / blaster / launcher / hammer / katana / board; one model per slot on the hand | An `Inventory`-ish `Weapons` behavior later; for now the gun is a `Mount`ed child | — |
| The trigger | `padUp` 20275, `WEAP.fireAt .78 / keepAt .48 / armT .09 / arc 1.05` | Right pad pushed UP past fireAt, held armT, inside the arc; hysteresis to keepAt; a hold that is not up is the camera | `play.html` right stick: `onHold`-style up-hold → `input.fire` (held) with the four gates; the camera keeps sideways drags | sticks: an "up hold" gesture (the left pad's `onHold` exists; the right needs the up test) |
| Charge | `WEAP.chargeT 1.15`, `minChg .10`, `chargeFx` 13823 | Held = a ball grows on the muzzle; release fires, under minChg is a fumble | `Blaster` behavior: charge while `input.fire`, fire on release | none |
| Muzzle | `muzzleWorld` 13732 | From the weapon's mesh bounds along the mount axis (the tip marker is NOT the muzzle) | `Blaster` measures it once off the gun's geometry (Deck's `extents`) | none |
| Aim | `aimPoint` 13741, `aimTarget` 13816, `AIM` 13800 | Walks the camera bearing out to `range` 60 m and bisects to the first wall; soft lock onto a body near the line | `Blaster`: `world.raycast` along the camera bearing (play.html gives `world.camYaw`), soft lock later | `world.camYaw` exposed to behaviors |
| The bolt | `fireBolt` 13937, `stepBolts` 16589, `boltHit` 14683, `glowBall` 13554 | A glowing ball, 44 m/s, size by charge (0.45 → 1.9 m), blast radius by charge; hits walls (decal), bodies, breakables | `Projectile` behavior (pooled spawned prefab) → on contact emits `blast(x,y,z,r,dmg)` + `struck` | runtime spawn exists (`world.spawn`) |
| Auto mode | `WEAP.modes` auto, `autoNow` 17063 | Held up = rapid fire of small bolts | `Blaster` param `mode: auto`, `rate` | none |
| Shoot pose | `WEAP.shootBeat .26 / shootHold .30`, `aimFrom 'shoot'` | Upper body takes the sighted pose while aiming, the shot clip on release | Animator upper layer (`animlayers.js`, like Melee) | none |
| DNA mode | `dnaNow` 17066, `dnaCatch` 13916, `MORPH` 5095, `morphGo` 30446, `bodyBorrow` 29494 | A DNA bolt that hits a body turns HIM into that kind (model swap, his collider and speeds kept; `MORPH.dur` 0.9 s proxy-blob morph) | `Disguise` behavior: on a `dna` hit, swap the entity's character to the target's (World can rebuild an entity's model) and back on REVERT | swapping a live entity's model + mixer (World API) |
| Virus mode | `virusOK` 33196, `VIRUS` | A hit turns a civilian into a warrior (the proxy blob between silhouettes) | Later, after Disguise | the morph proxy |
| Launcher | `ROCKET` 14519, `fireRocket` 14598, `ROCKETPOSE` 23725 | A rocket with kickback pose, big blast | `Blaster` param `kind: rocket` (a heavier Projectile) | none |

## Order for the next items

1. **`Blaster` + `Projectile`**: zap holds the blaster (a Mount child), the right-pad up-hold trigger in play.html (`input.fire`),
   charge → release → a glowing bolt along the camera bearing that emits `blast` where it lands (walls break, glass shatters,
   bodies are struck). A target range scene, or the kitchen sink's house.
2. **Auto mode + the shoot pose** (upper-body layer), the muzzle measured off the gun.
3. **`Disguise`** (the DNA gun): a hit body's character worn by the shooter, REVERT on the left wheel.
