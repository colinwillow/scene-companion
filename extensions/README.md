# Extensions

An extension is a folder here with an `extension.json` and one `.js` entry. It adds behaviors to the editor and the game
without touching Scene Companion's own code. `wobble/` is the example.

```json
{ "id": "wobble", "name": "Wobble", "version": "1.0.0", "engine": "^0.9.0", "entry": "index.js",
  "behaviors": ["Wobble"], "permissions": [] }
```

```js
export default function register({ Behavior, define }) {
  define('Wobble', class extends Behavior {
    static schema = { amount: { type: 'number', default: 0.08, min: 0, max: 0.5, step: 0.01 } };
    update(dt) { /* same API as a built-in behavior: this.entity, this.world, this.params */ }
  });
}
```

Rules (`npm run check` enforces them):
- **No imports.** Use what `register()` is handed. (That is what lets an extension run sandboxed later.)
- **Define exactly the behaviors you list**, PascalCase, and never a name a built-in already has.
- **Permissions:** using `fetch`/`WebSocket` needs `"network"`, `localStorage`/`indexedDB` needs `"storage"`, `document.`/`window.`
  needs `"dom"`. `eval`, `new Function` and `import()` are never allowed.
- **engine:** the range of Scene Companion it works with (`^0.9.0`); a scene can pin a version: `"extensions": ["wobble@^1.0.0"]`.

Turn one on in a scene: `"extensions": ["wobble"]` at the top of the scene file, then add the behavior to any object.
