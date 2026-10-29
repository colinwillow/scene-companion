# Packs as a product: the `.scpack` format and the store

Status: plan (Oct 29 2026). Nothing in here is legal advice. Before selling anything, check the Mixamo section against
Adobe's current terms (or with a lawyer).

## The idea

Sell **genre packs**: a hero in one style, a few enemies, NPCs, their animations already fitted to their bodies, sounds,
effects and a playable demo level. Unlock one in Scene Companion and it is in your project and playable straight away.
The same art can still be sold as plain FBX/glTF on Fab, CGTrader or itch.io. The in-engine version is the premium one,
because it is a working game kit and not a folder of files.

Synty's Polygon packs show that genre packs sell. What we add on top is "works on unlock" and "AI-ready": the pack says
what everything *is* (roles, behaviors), so Claude can build a game out of it through the editor's MCP.

## Principles

1. **The file format is a convenience, not a lock.** Anything a browser draws can be pulled out of it. There is no DRM:
   the protection is the licence plus the fact that the in-engine version is nicer. (Unity's Asset Store, Fab and Synty
   all work this way.)
2. **A pack is data the engine already understands.** Prefabs, `character.json` roles, behaviors, scenes, audio and
   effect presets: everything in a pack is already a format in this repo. The pack only bundles it.
3. **A pack you sell contains only art we own or may resell.** See the Mixamo section: some packs ship *recipes*
   instead of animation data.

## `.scpack`: the file

A zip (store, not deflate, for the already-compressed GLB/WebP/OGG), with the extension `.scpack`:

```
pack.json                  manifest (below)
thumbs/                    one PNG per prefab / character, plus cover.jpg
models/ textures/          GLB (draco + WebP / KTX2) and any loose images
characters/*.character.json   roles: idle / run / jump … → clip names
prefabs/*.prefab.json      ready objects, with their behaviors
audio/ fx/                 sounds and particle presets
scenes/*.scene.json        the demo level (opens on unlock)
recipes/                   optional: animation recipes for clips the buyer supplies (see Mixamo)
LICENSE.txt                the licence in plain words
```

`pack.json` grows from today's `packs/<id>/pack.json`:

```json
{
  "id": "samurai-dojo", "name": "Samurai Dojo", "version": "1.0.0",
  "engine": "^0.9.0",
  "tier": "paid",                          // free | unlock | paid
  "genre": ["action", "melee"],
  "characters": ["characters/samurai.character.json"],
  "prefabs": ["samurai", "ninja_enemy", "monk_npc", "dojo_gate"],
  "scenes": ["scenes/dojo-demo.scene.json"],
  "requires": [ { "kind": "clips", "source": "mixamo", "list": "recipes/mixamo-clips.json", "optional": true } ],
  "licence": "sc-pack-1",                  // what the buyer may do (below)
  "sha256": { "models/samurai.glb": "…" }  // integrity; also lets updates fetch only what changed
}
```

**Import:** drop the file on the editor (or the desktop app's "Open…", or tap a store card). The editor unzips it in the
browser (a small pure-JS unzip), checks the manifest with the existing pack/extension validators, writes the files into
the project (desktop: the project folder; web: the cloud project once accounts exist, IndexedDB until then), installs
it with the existing `setInstalled`, and opens the demo scene.

**Export:** `npm run pack <id>` zips `packs/<id>/` plus everything it references, checks that every reference resolves,
and writes `dist/<id>-<version>.scpack`. The same command can emit a plain glTF/FBX bundle for Fab or CGTrader.

## Unlocking and the store

| step | what | needs |
|---|---|---|
| 1 | `.scpack` import/export (above) and a free starter pack as a download | nothing: buildable now |
| 2 | Buy: a "merchant of record" (Lemon Squeezy or Paddle) sells it, handles VAT/sales tax, emails a licence key | Colin's account |
| 3 | Unlock: the editor sends the key to a tiny serverless check (Cloudflare Worker or Supabase function), which returns a signed entitlement plus a short-lived download link from R2 | accounts + R2 |
| 4 | Updates: a new version for the same key, fetching only files whose sha256 changed | step 3 |
| 5 | Other creators selling packs (payouts, moderation, quality checks) | much later; Stage 8 |

The unlock code that exists today (`?unlock=`, `sc.unlocks`) stays as the offline / dev path. A signed entitlement
replaces it once step 3 exists.

**Licence ("sc-pack-1", plain words):** use it in any number of your own games, free or paid; do not resell or share
the pack or its files as assets. That is the same deal as Synty's and Fab's.

## Mixamo: what we can and can't sell

Adobe's Mixamo terms (as commonly read; check the current text) let you use Mixamo characters and animations
royalty-free **inside** your own projects, including commercial games. You may **not** redistribute them as standalone
assets: selling or sharing the raw files, or putting them in an asset pack, is out.

- **Editing a Mixamo clip does not make it yours.** A clip that starts from Mixamo keyframes is still derived from
  their data, however much you change it. Treat any edited Mixamo clip as Mixamo.
- **A finished game for players: fine.** The clips are inside the game, not handed out as assets.
- **A kit sold to other developers, with Mixamo keyframes inside: not fine.** That is redistribution, even in our own
  file format. Encryption doesn't change that either.
- **Recipes: the clean way.** The Forge (`retarget-anims`) already works like this. A profile (e.g.
  `library/profiles/samurai.json`) holds no keyframes: only "role → which clip, by name" plus fitting dials (stance,
  wrists, feet, hand poses, layers). A pack can ship recipes like that. The buyer downloads Mixamo themselves with
  their own free Adobe account (we give them the list and the steps), drops the files in, and the Forge (or an import
  step in the editor) builds the fitted clips **on their machine**. The output is made under their Mixamo licence, and
  we never ship Adobe's data.
  - Recipe = clip names, which character, retarget dials, trims (in/out times), loop and root-motion flags, role
    mapping, hand poses. None of that is Mixamo's data.
  - Grey zone, avoid: shipping *correction curves* (keyframe deltas computed from a Mixamo clip). They are derived
    from the clip's data. Keep fixes procedural (dials the Forge applies), not stored keyframes.
  - Friction: the buyer has to fetch the clips themselves. Make that one page with a checklist and a "drop the folder
    here" box, and say up front: "works with Mixamo (free); clips not included".
- **What we CAN sell with animation baked in:** clips we own. That means Colin's own keyframed animation, mocap we
  record (phone or video mocap tools whose terms give you full rights to the output; check each tool's terms), or
  libraries bought with a redistribution licence. A pack can mix: owned "signature" clips baked in, plus a Mixamo
  recipe for the long tail (generic walk/run/idle variety).

So there are two kinds of pack:

| kind | animation inside | selling it |
|---|---|---|
| **complete** | only owned / cleared clips, baked in | sell anywhere, any tier |
| **recipe** | none from Mixamo; ships `recipes/`, built locally from the buyer's own Mixamo download | sell the pack; the buyer supplies Mixamo |

The free library inside Scene Companion can keep using Mixamo the way it does now (the clips stay out of git; the
Forge builds from the user's own library), because nothing there is sold as an asset.

## Order of work

1. `.scpack` export (`npm run pack`) and import (drop a file on the editor), with the existing starter pack as the
   first `.scpack`. No accounts needed.
2. Recipes in packs: the editor/Forge step "these clips are missing; drop your Mixamo folder here", which builds them
   from `recipes/` locally.
3. The licence page and a pack cover/card in the Library ("Install", "Get", "Owned").
4. The store (steps 2–4 of the table) once Colin has a Lemon Squeezy/Paddle account and the cloud accounts.
5. In the meantime: sell the same art on Fab / CGTrader / itch.io as plain files, with "also plays instantly in Scene
   Companion" in the listing.
