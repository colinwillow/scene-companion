// An extension's sandbox: a module Worker running runtime/sandbox-core.js. No DOM, no access to the game's objects —
// only the messages the host (runtime/sandbox-host.js) sends.
import { createSandboxCore } from './sandbox-core.js';
const core = createSandboxCore(m => self.postMessage(m));
self.onmessage = e => core.handle(e.data);
