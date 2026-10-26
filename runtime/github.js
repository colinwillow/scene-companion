// Save files straight to a GitHub repo with the contents API (fine-grained token, Contents: read & write).
// No three/DOM; takes fetch as a parameter so it can be tested without a network.

const API = 'https://api.github.com';
const b64 = s => { const bytes = new TextEncoder().encode(s); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));

// Read a file: { text, sha } or null if it doesn't exist.
export async function readFile({ repo, branch = 'main', path, token, fetch = globalThis.fetch }) {
  const r = await fetch(`${API}/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`, { headers: headers(token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read failed (${r.status}): ${(await r.json().catch(() => ({}))).message || ''}`);
  const j = await r.json();
  return { text: unb64(j.content), sha: j.sha };
}

// Commit `text` to `path`. If `expectText` is given and the repo copy differs from it (someone else pushed
// since we loaded), returns { conflict: true, remote } instead of writing, unless `force`.
export async function saveFile({ repo, branch = 'main', path, token, text, message, expectText, force = false, fetch = globalThis.fetch }) {
  const cur = await readFile({ repo, branch, path, token, fetch });
  if (cur && expectText !== undefined && !force && normalize(cur.text) !== normalize(expectText) && normalize(cur.text) !== normalize(text))
    return { conflict: true, remote: cur.text };
  if (cur && normalize(cur.text) === normalize(text)) return { unchanged: true };
  const body = { message: message || `Update ${path} from Scene Companion editor`, content: b64(text), branch, ...(cur ? { sha: cur.sha } : {}) };
  const r = await fetch(`${API}/repos/${repo}/contents/${encodeURI(path)}`, { method: 'PUT', headers: headers(token), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub save failed (${r.status}): ${(await r.json().catch(() => ({}))).message || ''}`);
  const j = await r.json();
  return { saved: true, commit: j.commit?.sha, url: j.commit?.html_url };
}

const headers = token => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' });
const normalize = s => s.replace(/\r\n/g, '\n').trimEnd();
