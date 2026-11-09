// Construct (MajiaStudio/construct) as a library: browse its catalog and use its assets by id.
//   A scene asset can point at a Construct asset instead of a file path:
//     "blue_dragon": { "variants": { "web": { "construct": "korajin-blue-dragon" } } }
//   World resolves it to the asset's hosted GLB before loading. Construct assets are metres, Y up, base at
//   the origin (the same convention as the Kenney models here), so props need no scale; characters get
//   "height" from the asset's real size. Any glb / height / scale / offset you set on the variant wins.
// Pure: no three, no DOM. fetch is passed in so tests can stub it.

export const CONSTRUCT_CATALOG = 'https://majiastudio.github.io/construct/catalog.json';

// Where to read the catalog: ?construct=<url>, then settings.construct.catalog, then the public site.
export function catalogUrl(settings = {}, search = '') {
  const q = search ? new URLSearchParams(search).get('construct') : null;
  return q || settings?.construct?.catalog || CONSTRUCT_CATALOG;
}

const loads = new Map();   // url -> Promise<catalog>
export function loadCatalog(url = CONSTRUCT_CATALOG, fetchFn = globalThis.fetch) {
  if (!loads.has(url)) {
    loads.set(url, (async () => {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`Construct catalog ${res.status}`);
      const data = await res.json();
      return { url, assets: data.assets || [], byId: new Map((data.assets || []).map(a => [a.id, a])) };
    })().catch(err => { loads.delete(url); throw err; }));   // a failed load can be retried
  }
  return loads.get(url);
}

// Only assets with a model file can be placed in a scene (materials, HDRIs and provider-hosted models can't yet).
export const isPlaceable = a => a?.type === 'model' && typeof a.mesh === 'string';
const isCharacter = a => (a.tags || []).some(t => t === 'character' || t === 'rigged' || t === 'creature');

// The scene asset key for a Construct id: lowercase_with_underscores, like entity ids.
export const assetKey = id => 'c_' + String(id).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// The scene asset entry that references a Construct asset.
export const constructAsset = id => ({ variants: { web: { construct: id } } });

// A variant with "construct" -> a plain variant World can load (glb + height when it's a character).
export function resolveVariant(variant, catalog) {
  if (!variant?.construct) return variant;
  const a = catalog.byId.get(variant.construct);
  if (!a) throw new Error(`No Construct asset "${variant.construct}" in ${catalog.url}`);
  if (!isPlaceable(a)) throw new Error(`Construct asset "${variant.construct}" has no model to place (it's a ${a.type})`);
  const out = { ...variant, glb: variant.glb || a.mesh };
  if (out.height === undefined && out.scale === undefined && isCharacter(a) && a.dimensions_m) out.height = a.dimensions_m[1];
  return out;
}

// Library list: placeable assets matching a search (name, tags; every word must match), characters first.
export function search(catalog, query = '', { limit = 200 } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = catalog.assets.filter(isPlaceable).filter(a => {
    const hay = `${a.name} ${(a.tags || []).join(' ')}`.toLowerCase();
    return words.every(w => hay.includes(w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  });
  hits.sort((a, b) => (isCharacter(b) - isCharacter(a)) || a.name.localeCompare(b.name));
  return hits.slice(0, limit).map(a => ({
    id: a.id, name: a.name, thumb: a.thumbnail, character: isCharacter(a),
    size: a.dimensions_m, tags: a.tags || [], credit: a.attribution || a.author || '',
  }));
}
