import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoodLookup, normalizeUSDA, normalizeQuery } from '../apps/api/dist/foods/lookup.js';

const food = (description = 'Papayas, raw') => ({ fdcId: 169926, description, foodNutrients: [{ nutrientId: 1008, unitName: 'KCAL', value: 43 }, { nutrientId: 1003, unitName: 'G', value: 0.47 }, { nutrientId: 1005, unitName: 'G', value: 10.82 }, { nutrientId: 1004, unitName: 'G', value: 0.26 }, { nutrientId: 1079, unitName: 'G', value: 1.7 }] });
test('lookup retains per-100g source values, provenance, raw basis, and true zeroes', () => {
  const result = normalizeUSDA(food());
  assert.equal(result.kcal, 43);
  assert.equal(result.protein, 0.47);
  assert.equal(result.basis, 'raw');
  assert.equal(result.license, 'CC0-1.0');
  assert.equal(result.sourceUrl, 'https://fdc.nal.usda.gov/food-details/169926/nutrients');
  assert.deepEqual(result.missing, []);
  const incomplete = food('Chicken, cooked'); incomplete.foodNutrients = [{ nutrientId: 1005, unitName: 'G', value: 0 }];
  const normalized = normalizeUSDA(incomplete);
  assert.equal(normalized.basis, 'prepared');
  assert.equal(normalized.carbs, 0);
  assert.equal(normalized.fiber, null);
  assert.ok(normalized.missing.includes('fiber'));
});
test('search uses fixed USDA endpoint, regional aliases, timeouts, rate limits, and cache', async () => {
  let calls = 0, sentBody, sentUrl, time = 10000;
  const lookup = createFoodLookup({ apiKey: 'DEMO_KEY', now: () => time, fetchImpl: async (url, options) => { calls++; sentUrl = url; sentBody = JSON.parse(options.body); return { ok: true, json: async () => ({ foods: [food('Papaya, cooked'), food()] }) }; } });
  const result = await lookup('  PALAK ');
  assert.equal(sentUrl.hostname, 'api.nal.usda.gov');
  assert.equal(sentBody.query, 'spinach raw');
  assert.equal(result.results[0].basis, 'raw');
  assert.equal(result.demoKey, true);
  assert.equal((await lookup('palak')).cached, true);
  assert.equal(calls, 1);
  await assert.rejects(() => lookup('ragi'), /wait a moment/);
  time += 3000; await lookup('ragi'); assert.equal(calls, 2);
  assert.throws(() => normalizeQuery('a'));
});
test('provider failure leaves manual entry available and never invents nutrition', async () => {
  await assert.rejects(() => createFoodLookup({ fetchImpl: async () => ({ status: 429, ok: false }) })('papaya'), /limit/);
  await assert.rejects(() => createFoodLookup({ fetchImpl: async () => { throw new Error('Network down'); } })('papaya'), /saved library still works/);
});
