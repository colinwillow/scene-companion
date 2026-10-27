# Colin's feedback

Colin writes notes here after playtesting. Every build run reads this first and handles anything new before starting the next roadmap item. Mark each note done with a short reply.

- 2026-10-26 (Colin): Robot player didn't show up on the test page (v3) — still looked like a capsule scene. A fix went in (precise bounding box after world-matrix update) plus an on-screen error box. Verify the robot loads and stands on the ground at ~1.75 m; if not, find the real cause.
  - ✅ Done (build run 22:58 UTC): checked in headless Chromium — robot `player` loads, measures 1.73 m (animated pose), feet at y=0; `npc_waver` the same. No errors in the error box. Added a `window.__sc` debug hook so future runs can measure this automatically.
- 2026-10-26 (Colin): Overall it looks like 1980s graphics. Make it look like a real game — see Stage 1.5 in the roadmap.
  - ✅ Sky, post-processing, shadows/ground and toon upgrade are in (live session). Last Stage 1.5 item (real CC0 models) is being built now.

- 2026-10-27 (Colin, phone playtest of Sky Steps + the editor): Sky Steps plays, everything was there. Editor: tap-select ✓, swipe navigation ✓, gizmo with a thumb ✓ portrait + landscape, behavior sliders make sense ✓, Play/Stop restores ✓. Problems:
  1. **＋Add drops the object at the map centre, not where I'm looking.** I'd panned away, hit Add, "nothing happened", had to go find the centre. Place it at the centre of the camera view on the ground (raycast the screen centre to the ground/whatever surface is there). Matters a lot on big maps.
     - ✅ Done (build run 04:03 UTC): ＋Add, Library taps and MCP spawn now land where the middle of the screen meets the ground or a platform top. Cause: one-finger pan moves the orbit focus up in the air, so 'below the focus' was metres away from what you were looking at. Duplicate now puts the copy beside the original as you see it. Unverified on a phone.
  2. **The inspector sheet pops up on every selection and covers most of the screen.** I keep tapping off things (tapping the ground) to navigate, and it pops up over and over. Selecting should just highlight the object (outline + a small name chip); open the inspector from the chip or a button. Tapping empty ground deselects without opening anything. Still has to be obvious what's selected.
  3. **Game controls aren't mine.** Copy how my games do it (see `rollergirl`/`weirdport` `bindStick`, Peggy/BigDon `Joystick.js`): two floating, stylized on-screen sticks; LEFT = locomotion, RIGHT = camera orbit (yaw only, no pitch); jump = a TAP on the right stick (option: tap either stick); no separate jump button. Hold and flick on both sticks stay free for future verbs.
  4. Sky Steps idea: it's cute, like a little 3D Mario. Double jump, second jump a flip (Zap has `front_flip`).
