# Handoff — 2026-10-27

From the scheduled build runs (cloud, could only see `scene-companion` + `blender-addons`) to a Claude Code session in Colin's own cloud environment (Blender, mocap tools, all his repos).

## Where things stand
- Read in this order: `CLAUDE.md` → `SPEC.md` → `BUILD-LOOP.md` → `FEEDBACK.md` → `ROADMAP.md` → tail of `LOG.md`.
- Stages 1–4 are done. Stage 5 is mostly done: the MCP server (`tools/mcp-server.mjs`, `.mcp.json`) works with a phone/desktop editor or its own headless one.
- `npm run check` passes with 78 tests.
- Not yet playtested by Colin: the Tiny Hop feel pass (jump clip, platform riding, camera collision, sounds, squash, footsteps), the LIVE badge, game→editor state reporting, and 🎯 pick mode. Treat his next FEEDBACK.md notes as the priority.
- Next roadmap item: **Finish-line test.** Claude builds a small game through MCP alone (`SC_HEADLESS=always` works for this).

## Why the handoff
The build runs couldn't reach Colin's other repos, so two roadmap items are blocked on assets:
- **More CC0 models:** rocks, crates, a ground enemy.
- **A fall animation for Tiny Hop.** `Animator.fallClip` is ready; it needs a character with a Fall/Falling clip.

## Assets to pull in (Colin's own, fine to use)
Attach these repos to the new session (read access is enough). The names came through talk-to-text, so confirm the real repo names:
- weirdport
- Shred World
- Peggy
- Roller Girl
- Plutopia
- B-boy
- Zap
- the mocap / motion app, which has an MCP layer for motion data

Already seen in `blender-addons/pipeline/out/*_3d/anim.glb`: 13 rigged characters (grunt, heavy, shooter, boss, CEO, cook, worker, skel and more). Each is about 7 MB with 30+ clips: idle/walk/run/strafe, rifle, melee, hits, knockdown falls, get-ups. They don't have jump or air-fall clips. `pipeline/out/wrap/zap*` is the Zap rig proxy.

House rules for imported assets: textures 512–2K, GLB under ~20 MB (Draco), Mixamo bone names, 1 unit = 1 m. Add each one to the scene `assets` with a `height` variant for characters, and make a prefab for anything that repeats.

## Scheduled runs
Both Scene Companion schedules are **paused**, not deleted:
- "Scene Companion build" (hourly at :54, Mon/Tue)
- "Scene Companion build (Wed early)"

Re-enable them, or recreate them from the new session, with the prompt below. The library runs ("My Stack run", "Game Studies run") are untouched and still active.

Prompt used by the build runs:
> You are running one ~45-minute build block on Colin's Scene Companion project, a visual editor companion for AI-built Three.js games.
> 1. Attach the GitHub repo colinwillow/scene-companion with push access, then clone it.
> 2. Follow BUILD-LOOP.md exactly: read CLAUDE.md, SPEC.md, FEEDBACK.md and ROADMAP.md; handle new feedback first; then claim and build roadmap items back to back (top unchecked, not already IN PROGRESS), pushing after each one, until about 45 minutes have passed.
> 3. Keep behaviors pure JavaScript (no three/DOM imports), keep `npm run validate` passing, and keep the kitchen-sink scene working.
> 4. Always fetch and rebase before pushing; a live session with Colin may be pushing too.
> 5. Finish with a short, phone-readable report: what you built, how to try it, what's unverified, and what's next.
> If something blocks you, note it under the roadmap item with [blocked] and a one-line reason, log it, and move to the next item.

When recreating them, also attach the asset repos above, so runs can take models directly.

## Gotchas learned
- The headless browser has no GPU, so it's slow: an editor rebuild takes 10–60 s, so use generous timeouts. Route `cdn.jsdelivr.net/npm/three@0.170.0/*` to `node_modules/three` (the MCP server already does this).
- `window.__sc` on both pages is the debug hook (world, data, live status).
- Game pages mark debug meshes with `// sc:overlay` so the validator doesn't flag them.
