import type { Nutrient, LookupFood, LookupResult } from '@nourish/contracts';
import { nutrients } from '../nutrition/engine';

const aliases: Record<string, string> = { ragi: 'finger millet', 'ragi flour': 'finger millet flour', jowar: 'sorghum grain', bajra: 'pearl millet', 'green gram': 'mung beans mature seeds raw', moong: 'mung beans mature seeds raw', 'black chana': 'chickpeas raw', 'toor dal': 'pigeon peas raw', 'urad dal': 'black gram raw', avarekalu: 'hyacinth beans raw', palak: 'spinach raw', mosambi: 'sweet lime', chikoo: 'sapodilla raw', sapota: 'sapodilla raw', 'lady finger': 'okra raw', vendakkai: 'okra raw', brinjal: 'eggplant raw', 'ground nuts': 'peanuts raw' };
export function normalizeQuery(value: unknown) { const q = String(value || '').trim().replace(/\s+/g, ' ').toLowerCase(); if (q.length < 2 || q.length > 80) throw new Error('Enter a food name between 2 and 80 characters.'); return q; }
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? +value.toFixed(2) : null;
export function normalizeUSDA(food: Record<string, any>): LookupFood | null {
  const values = food.foodNutrients || [];
  const value = (ids: number[], unit: string) => {
    for (const id of ids) {
      const n = values.find((n: any) => Number(n.nutrientId ?? n.nutrient?.id) === id && String(n.unitName ?? n.nutrient?.unitName).toLowerCase() === unit);
      if (n) return finite(n.value ?? n.amount);
    }
    return null;
  };
  let kcal = value([1008, 2048, 2047], 'kcal');
  if (kcal === null) { const kj = value([1062], 'kj'); if (kj !== null) kcal = +(kj / 4.184).toFixed(2); }
  const name = String(food.description || '').slice(0, 100);
  if (!name || !Number.isInteger(food.fdcId)) return null;
  const basis = /cooked|boiled|fried|roasted|baked|stewed|prepared|canned/i.test(name) ? 'prepared' : /\braw\b|uncooked|dry|dried|flour/i.test(name) ? 'raw' : 'unconfirmed';
  const result: LookupFood = { externalId: String(food.fdcId), name, category: '', kcal, protein: value([1003], 'g'), carbs: value([1005], 'g'), fat: value([1004], 'g'), fiber: value([1079], 'g'), basis, source: `USDA FoodData Central · FDC ${food.fdcId} · CC0`, sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`, provider: 'USDA FoodData Central', license: 'CC0-1.0', missing: [] };
  result.missing = nutrients.filter(n => result[n] === null);
  return result;
}
export function createFoodLookup({ fetchImpl = fetch, apiKey = process.env.USDA_API_KEY || 'DEMO_KEY', now = Date.now }: { fetchImpl?: typeof fetch; apiKey?: string; now?: () => number } = {}) {
  const cache = new Map<string, { at: number; value: LookupResult }>();
  let lastRequest = -Infinity;
  return async (query: unknown): Promise<LookupResult> => {
    const q = normalizeQuery(query);
    const cached = cache.get(q);
    if (cached && now() - cached.at < 24 * 60 * 60 * 1000) return { ...cached.value, cached: true };
    if (now() - lastRequest < 2000) throw new Error('Please wait a moment between online searches.');
    lastRequest = now();
    const endpoint = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
    endpoint.searchParams.set('api_key', apiKey);
    let response;
    try {
      response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'NourishBoard/0.2 (https://github.com/sjbangre/nourish-board)' }, body: JSON.stringify({ query: aliases[q] || q, dataType: ['Foundation', 'SR Legacy'], pageSize: 16 }), signal: AbortSignal.timeout(12000) });
    } catch { throw new Error('Online nutrition search is unavailable. Your saved library still works; try again later or enter label values manually.'); }
    if (response.status === 429) throw new Error('The free nutrition lookup limit has been reached. Try later, use your saved library, or configure a free USDA_API_KEY.');
    if (!response.ok) throw new Error(`Nutrition provider is unavailable (${response.status}). Use manual entry or try again later.`);
    const data = await response.json() as { foods?: Record<string, any>[] };
    const results = (Array.isArray(data.foods) ? data.foods : []).map(normalizeUSDA).filter((f): f is LookupFood => Boolean(f)).sort((a, b) => (a.basis === 'raw' ? 0 : a.basis === 'prepared' ? 2 : 1) - (b.basis === 'raw' ? 0 : b.basis === 'prepared' ? 2 : 1)).slice(0, 10);
    const value = { results, query: q, searchedFor: aliases[q] || q, provider: 'USDA FoodData Central', demoKey: apiKey === 'DEMO_KEY', cached: false, notice: apiKey === 'DEMO_KEY' ? 'Free demo lookup: 30 requests/hour and 50/day per server IP. Add a free USDA_API_KEY for regular family use.' : 'Food names can have several matches. Review the source, preparation, and missing fields before saving.' };
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(q, { at: now(), value });
    return value;
  };
}
