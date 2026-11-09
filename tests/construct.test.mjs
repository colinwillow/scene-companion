import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, resolveVariant, search, assetKey, constructAsset, catalogUrl, CONSTRUCT_CATALOG } from '../runtime/construct.js';
import { runCommand } from '../runtime/commands.js';

// A tiny catalog in the shape MajiaStudio/construct publishes (catalog.json).
const CATALOG = { assets: [
  { id: 'korajin-blue-dragon', name: 'Blue Dragon', type: 'model', tags: ['creature', 'dragon', 'korajin'],
    dimensions_m: [3.66, 3.2, 6.86], mesh: 'https://r2.example/assets/korajin-blue-dragon/mesh.glb', thumbnail: 'https://r2.example/t.png' },
  { id: 'rollergirl-skate-kicker', name: 'Kicker', type: 'model', tags: ['ramp', 'skate'], dimensions_m: [1.3, 0.58, 1.3],
    mesh: 'https://r2.example/assets/rollergirl-skate-kicker/mesh.glb', thumbnail: 'https://r2.example/k.png' },
  { id: 'korajin-mat-bronze', name: 'Bronze', type: 'material', tags: ['metal'], textures: {} },
  { id: 'polyhaven-barrel-01', name: 'Barrel', type: 'model', tags: ['props'], source: { provider: 'polyhaven' } },   // no mesh: not placeable yet
] };
const fakeFetch = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });

test('loadCatalog indexes by id, caches, and retries after a failure', async () => {
  const c = await loadCatalog('test://a', fakeFetch(CATALOG));
  assert.equal(c.byId.get('korajin-blue-dragon').name, 'Blue Dragon');
  assert.equal(await loadCatalog('test://a', fakeFetch({ assets: [] })), c);           // cached per URL
  await assert.rejects(loadCatalog('test://b', fakeFetch({}, false)), /500/);
  assert.equal((await loadCatalog('test://b', fakeFetch(CATALOG))).assets.length, 4);  // the failure wasn't cached
});

test('resolveVariant: a construct variant becomes a glb (+ height for creatures and characters)', async () => {
  const c = await loadCatalog('test://a', fakeFetch(CATALOG));
  const dragon = resolveVariant({ construct: 'korajin-blue-dragon' }, c);
  assert.equal(dragon.glb, 'https://r2.example/assets/korajin-blue-dragon/mesh.glb');
  assert.equal(dragon.height, 3.2);
  const kicker = resolveVariant({ construct: 'rollergirl-skate-kicker' }, c);
  assert.equal(kicker.height, undefined);                                                // props are already metres
  assert.equal(resolveVariant({ construct: 'korajin-blue-dragon', scale: 2 }, c).height, undefined);   // the scene's own scale wins
  assert.equal(resolveVariant({ construct: 'korajin-blue-dragon', glb: './x.glb' }, c).glb, './x.glb');
  assert.throws(() => resolveVariant({ construct: 'nope' }, c), /No Construct asset "nope"/);
  assert.throws(() => resolveVariant({ construct: 'korajin-mat-bronze' }, c), /no model to place/);
  const plain = { glb: './a.glb' };
  assert.equal(resolveVariant(plain, c), plain);                                         // non-Construct variants untouched
});

test('search: placeable models only, every word must match, creatures first', async () => {
  const c = await loadCatalog('test://a', fakeFetch(CATALOG));
  assert.deepEqual(search(c).map(h => h.id), ['korajin-blue-dragon', 'rollergirl-skate-kicker']);
  assert.deepEqual(search(c, 'skate ramps').map(h => h.id), ['rollergirl-skate-kicker']);   // plural still matches
  assert.deepEqual(search(c, 'dragon skate'), []);
  assert.equal(search(c, '', { limit: 1 }).length, 1);
});

test('asset keys and catalog URL', () => {
  assert.equal(assetKey('korajin-blue-dragon'), 'c_korajin_blue_dragon');
  assert.deepEqual(constructAsset('x'), { variants: { web: { construct: 'x' } } });
  assert.equal(catalogUrl({}), CONSTRUCT_CATALOG);
  assert.equal(catalogUrl({ construct: { catalog: 'https://my/catalog.json' } }), 'https://my/catalog.json');
  assert.equal(catalogUrl({}, '?construct=http://localhost:8000/catalog.json'), 'http://localhost:8000/catalog.json');
});

test('spawn { construct }: adds the asset reference once, places entities, rejects bad ids', () => {
  const d = { settings: {}, assets: {}, entities: [] };
  const a = runCommand(d, 'spawn', { construct: 'korajin-blue-dragon', position: [1, 0, 2] }, {}).result;
  const b = runCommand(d, 'spawn', { construct: 'korajin-blue-dragon' }, {}).result;
  assert.notEqual(a.id, b.id);
  assert.deepEqual(d.assets, { c_korajin_blue_dragon: { variants: { web: { construct: 'korajin-blue-dragon' } } } });
  assert.equal(d.entities.filter(e => e.asset === 'c_korajin_blue_dragon').length, 2);
  assert.throws(() => runCommand(d, 'spawn', { construct: 'Bad Id!' }, {}), /Construct asset id/);
  assert.throws(() => runCommand(d, 'spawn', { construct: 'x', asset: 'y' }, {}), /one of prefab, asset or construct/);
});
