# Colin's feedback

Colin writes notes here after playtesting. Every build run reads this first and handles anything new before starting the next roadmap item. Mark each note done with a short reply.

- 2026-10-26 (Colin): Robot player didn't show up on the test page (v3) — still looked like a capsule scene. A fix went in (precise bounding box after world-matrix update) plus an on-screen error box. Verify the robot loads and stands on the ground at ~1.75 m; if not, find the real cause.
  - ✅ Done (build run 22:58 UTC): checked in headless Chromium — robot `player` loads, measures 1.73 m (animated pose), feet at y=0; `npc_waver` the same. No errors in the error box. Added a `window.__sc` debug hook so future runs can measure this automatically.
- 2026-10-26 (Colin): Overall it looks like 1980s graphics. Make it look like a real game — see Stage 1.5 in the roadmap.
  - ✅ Sky, post-processing, shadows/ground and toon upgrade are in (live session). Last Stage 1.5 item (real CC0 models) is being built now.
