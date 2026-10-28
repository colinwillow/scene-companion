# UI audit (Stage 9, item 1)

Screenshots: `docs/ui/audit/` (regenerate with `npm run ui:shots docs/ui/audit`). Phone shots are 390×844 portrait
and 844×390 landscape. Desktop shots are 1280×800. Ranked worst first. Each Stage 9 item below fixes some of these;
the item that owns each problem is in brackets.

## 1. Broken or cut off: fix these first

1. **The Library tabs are cut off.** In portrait the first and last tabs are clipped off the screen, so tabs exist that
   can't be seen and have no scroll hint. See [library-props](ui/audit/library-props.jpg) and
   [library-ext](ui/audit/library-ext.jpg). *[Library redesign]*
2. **Landscape editor: the toolbar runs under the side panel.** Move, Scatter and Snap are greyed out and
   unreachable, because the panel overlaps the toolbar. See [editor-landscape](ui/audit/editor-landscape.jpg) and
   [inspector-landscape](ui/audit/inspector-landscape.jpg). *[thumb layout]*
3. **The tool pages don't fill a desktop screen.** VFX and Sprite bake render as a small block in the corner of a
   1280 px window. See [vfx-desktop](ui/audit/vfx-desktop.jpg) and [spritebake](ui/audit/spritebake.jpg).
   *[tool pages]*
4. **The play HUD hint text sits on top of the sticks**, and the HUD buttons (🎯 🎬 ⏸ 🔊 ▦ Edit) are tiny emoji,
   well under a 44 px thumb target. See [play-portrait](ui/audit/play-portrait.jpg) and
   [play-landscape](ui/audit/play-landscape.jpg). *[play HUD polish]*

## 2. Cramped

5. **The portrait editor spends about 20% of the screen on four toolbar rows** before the scene starts. See
   [editor-portrait](ui/audit/editor-portrait.jpg). *[thumb layout]*
6. **The inspector sheet covers half the scene**, so you can't see the object you are editing. Its action row
   (Duplicate / Delete / → Blender / → Forge / ⇦ From Forge) is five small buttons crammed in a line, and the
   behavior card titles are truncated. See [inspector](ui/audit/inspector.jpg) and
   [editor-selected](ui/audit/editor-selected.jpg). *[inspector redesign]*
7. **Library rows cut descriptions mid-word.** The Extensions rows wrap awkwardly, and the panel covers the scene it
   is adding to. See [library-characters](ui/audit/library-characters.jpg),
   [library-generate](ui/audit/library-generate.jpg) and [library-ext](ui/audit/library-ext.jpg). *[Library redesign]*
8. **The VFX portrait page is a huge empty preview** with its controls pushed below the fold. See
   [vfx-portrait](ui/audit/vfx-portrait.jpg). *[tool pages]*

## 3. Confusing

9. **Copy vs ⇪ Save is unclear.** There are two buttons that both "keep" the scene and nothing says which one goes
   where. *[thumb layout, icon set]*
10. **Emoji and text labels are mixed with no rule.** Some buttons are icons only, some are words, and some are both.
    *[icon set]*
11. **The pbr/web selects are bare native dropdowns** with no label saying what they choose (look and tier). *[design
    system]*
12. **The LIVE badge on play is clutter.** It tells the player nothing they can act on. *[play HUD polish]*
13. **The desktop editor's side panel is empty until something is selected**, a dead third of the screen. See
    [editor-desktop](ui/audit/editor-desktop.jpg). *[inspector redesign]*

## 4. Ugly or inconsistent

14. **There are no shared tokens.** Every page invents its own greys, radii, button heights and fonts, so the editor,
    play, VFX, Sprite bake and slicer look like five apps. *[design system]*
15. **Native blue range sliders** on VFX and in the inspector clash with the dark UI. *[design system]*
16. **The scene picker is a text list with no thumbnails.** See [play-scenes](ui/audit/play-scenes.jpg). *[scene
    picker cards]*
17. **Pause, the title card and the mixer work but are plain.** They have no motion, no depth and default type. See
    [play-pause](ui/audit/play-pause.jpg), [play-title](ui/audit/play-title.jpg) and
    [play-mixer](ui/audit/play-mixer.jpg). *[play HUD polish, feel]*
18. **Scenes read hazy behind the UI.** The default look's fog and exposure flatten everything in the small editor
    viewport. This is a taste call, so it goes on a switch. *[design system]*

## What is already good

- **The tile palette** ([tile-paint](ui/audit/tile-paint.jpg)) is big, clear, and has thumb-sized swatches. Use it as
  the model for the Library.
- **The slicer** ([slicer](ui/audit/slicer.jpg)) has a clear grid and readable controls.
- **The 2D play view** ([play-2d](ui/audit/play-2d.jpg)) is clean. It only needs the HUD fixes.
