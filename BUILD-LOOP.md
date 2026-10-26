# Build loop — one run

Each run is a ~45-minute work block. Keep taking roadmap items back to back until about 45 minutes have passed, then wrap up, so the next hourly run never overlaps this one.

1. Read CLAUDE.md, SPEC.md, FEEDBACK.md, ROADMAP.md.
2. Handle new FEEDBACK.md notes first (fix, then reply under the note with what changed).
3. Take the top unchecked ROADMAP item that isn't marked IN PROGRESS. **Claim it first**: add `[IN PROGRESS <time>]` to the line, commit and push, so a live session or another run won't grab it. Ignore IN PROGRESS claims older than 2 hours (a run probably died).
4. Build it. Stay inside the item; note follow-ups as new roadmap items instead of doing them.
5. Keep behaviors pure (no three/DOM imports). Keep `npm run check` (validate + tests) and the kitchen-sink scene working; add tests for new behaviors; add to the kitchen-sink scene whenever a feature is added.
6. Check the item off, append a line to LOG.md (`date — item — result`), fetch + rebase, commit and push to main.
7. If under ~45 minutes, go back to step 3. Otherwise stop.
8. Report to Colin, phone-readable: what was built (each item), how to try it, what's unverified, what's next.
