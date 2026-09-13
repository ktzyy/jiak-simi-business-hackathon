import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { readSharedDemoPreset } from './demo-preset';
import { menuFromEdits } from './review-state';
import { withSharedExtras } from './shared-extras';
import { dishPhotoCandidateSchema } from '@/shared/dish-photo';
const restaurantId = 'ba2ad996-da84-4653-89a9-c028d77c050d';
test('shared demo loads independently of browser storage with ten exact polished photos', async t => {
  t.mock.method(globalThis, 'fetch', async (path: string) => new Response(await readFile(`public${path}`)));
  const first = (await readSharedDemoPreset(restaurantId))!;
  assert.equal(first.dishes.length, 10);
  assert.equal(Object.keys(first.crops).length, 10);
  assert.equal(Object.keys(first.photos.blobs).length, 10);
  for (const dish of first.dishes) {
    const record = first.photos.records[dish.id];
    assert.equal(record.selected, true);
    assert.equal(record.status, 'ready');
    assert.equal(record.request.dishName, dish.name);
    const candidate = dishPhotoCandidateSchema.parse(record.candidate);
    assert.equal(candidate.dishId, dish.id);
    assert.equal(createHash('sha256').update(Buffer.from(await first.photos.blobs[dish.id].arrayBuffer())).digest('hex'), candidate.imageSha256);
    assert.ok(first.crops[dish.id].file.size);
  }
  const dishes = withSharedExtras(first.dishes, first.sharedRows, first.excludedExtras, randomUUID());
  assert.equal(menuFromEdits({dishes,id:randomUUID(),restaurantId,version:1,name:first.name}).dishes.length,10);
  first.dishes[0].name = 'Visitor edit';
  assert.equal((await readSharedDemoPreset(restaurantId))!.dishes[0].name,'Char Siew Rice');
});
test('other restaurants do not load demo photo jobs', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected fetch'); });
  assert.equal(await readSharedDemoPreset(randomUUID()), null);
  assert.equal(fetch.mock.callCount(), 0);
});
test('unavailable shared preset reports failure instead of silently repeating OCR', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', {status:503}));
  await assert.rejects(readSharedDemoPreset(restaurantId), /demo could not load/);
});
