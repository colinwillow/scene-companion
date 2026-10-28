# Ship a scene as a phone app (Capacitor)

`npm run export:app scenes/<scene>.scene.json --id com.you.game --name "My Game"` writes `export/app/<scene>/`:

- `www/` — the whole game, **offline**: the play page opening straight into that scene (no editor or scene-list buttons),
  three.js vendored next to it, the runtime and behaviors, and only the files the scene reaches (models, the textures
  beside them, sounds, prefabs, characters). Checked by loading it with every outside request blocked.
- `capacitor.config.json` (app id + name, `webDir: www`) and `package.json` (Capacitor 6).

The rest needs a computer with the platform's tools — it cannot be done from a phone or from this repo's cloud sessions:

| | iOS | Android |
|---|---|---|
| needs | a Mac with Xcode, an Apple Developer account ($99/yr) to put it on the App Store | Android Studio, a Google Play developer account ($25 once) |
| 1 | `cd export/app/<scene> && npm install` | same |
| 2 | `npx cap add ios` | `npx cap add android` |
| 3 | `npx cap open ios` → in Xcode pick your team, plug in the phone, ▶ | `npx cap open android` → ▶ on a phone or emulator |
| icons | `npx @capacitor/assets generate` with `assets/icon.png` (1024²) and `assets/splash.png` in that folder | same |
| store | Product → Archive → Distribute (App Store Connect) | Build → Generate Signed Bundle → upload to Play Console |

After changing the game: run `npm run export:app` again, then `npx cap sync` in the app folder.

Not done yet: icons are not generated for you, there is no native plugin use (haptics, Game Center), and the app is
the play page as it is — the HUD buttons and title card included.
