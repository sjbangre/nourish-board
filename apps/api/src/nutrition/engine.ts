import type { Food, Nutrient, Profile } from '@nourish/contracts';
export const nutrients: Nutrient[] = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];
export const defaultPreferences = ['chicken', 'eggs', 'greengram', 'chana', 'rice', 'oats', 'spinach', 'beans', 'carrot', 'banana', 'almonds', 'oil'];
const bounded = (v: unknown, min: number, max: number, label: string) => {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return n;
};
export function validateProfile(p: Record<string, any>) {
  const name = String(p.name || '').trim().slice(0, 60);
  if (!name) throw new Error('Please enter a name.');
  if (!['male', 'female'].includes(p.sex)) throw new Error('Choose the sex coefficient for the energy equation.');
  if (!['gym', 'home'].includes(p.equipment)) throw new Error('Choose gym or home equipment.');
  if (!['beginner', 'intermediate'].includes(p.experience)) throw new Error('Choose a training experience level.');
  const trainingDays = bounded(p.trainingDays, 2, 4, 'Strength days');
  if (!Number.isInteger(trainingDays)) throw new Error('Strength days must be a whole number.');
  return { name, sex: p.sex, age: bounded(p.age, 18, 80, 'Age'), height: bounded(p.height, 120, 230, 'Height'), weight: bounded(p.weight, 35, 250, 'Weight'), goalWeight: bounded(p.goalWeight, 35, 250, 'Goal weight'), activity: bounded(p.activity, 1.2, 1.9, 'Activity multiplier'), deficit: bounded(p.deficit, 0, 20, 'Deficit percentage'), proteinRate: bounded(p.proteinRate, 1.4, 2, 'Protein g/kg'), wheyGrams: bounded(p.wheyGrams, 0, 60, 'Whey grams'), trainingDays, equipment: p.equipment, experience: p.experience, excluded: Array.isArray(p.excluded) ? p.excluded.map(String).slice(0, 200) : [], favorites: Array.isArray(p.favorites) ? [...new Set(p.favorites.map(String))].slice(0, 200) : defaultPreferences, needsReview: Boolean(p.needsReview), configured: true };
}
export function validateFood(f: Record<string, any>) {
  if (!String(f.name || '').trim()) throw new Error('A food name is required.');
  if (!['Non-veg', 'Legumes', 'Dairy & alternatives', 'Grains', 'Greens', 'Vegetables', 'Fruit', 'Fats & nuts', 'Supplement'].includes(f.category)) throw new Error('Choose a food category.');
  const out: Record<string, any> = { name: String(f.name).trim().slice(0, 100), category: f.category, basis: 'raw', source: String(f.source || 'User-supplied nutrition label').slice(0, 200), maxGrams: bounded(f.maxGrams, 5, 1000, 'Maximum daily grams') };
  for (const n of nutrients) out[n] = bounded(f[n], 0, n === 'kcal' ? 950 : 100, n);
  if (!out.kcal) throw new Error('Calories must be greater than zero.');
  if (f.sourceUrl) {
    let url; try { url = new URL(f.sourceUrl); } catch { throw new Error('Invalid nutrition source link.'); }
    if (url.protocol !== 'https:') throw new Error('Nutrition source links must use HTTPS.');
    out.sourceUrl = url.href.slice(0, 500);
  }
  if (f.provider) out.provider = String(f.provider).slice(0, 60);
  if (f.license) out.license = String(f.license).slice(0, 60);
  if (f.externalId) out.externalId = String(f.externalId).slice(0, 60);
  return out;
}
export function targets(p: Profile) {
  if (!p.configured) throw new Error('Set up this profile first.');
  if (p.needsReview) throw new Error('Personalized plans are paused for this profile. Review your needs with a qualified professional before enabling estimates.');
  const bmi = Number(p.weight) / (Number(p.height) / 100) ** 2;
  if (bmi < 18.5 && p.deficit > 0) throw new Error('A calorie deficit is not generated for a BMI below 18.5. Choose maintenance and seek personalized guidance.');
  if (Number(p.goalWeight) > Number(p.weight) && p.deficit > 0) throw new Error('A higher goal weight does not match a calorie deficit. Choose maintenance or lower the goal weight.');
  const bmr = 10 * Number(p.weight) + 6.25 * Number(p.height) - 5 * Number(p.age) + (p.sex === 'male' ? 5 : -161);
  const maintenance = Math.round(bmr * p.activity);
  // Conservative product guardrails, not individually prescribed minimum intakes.
  const floor = p.sex === 'male' ? 1500 : 1200;
  const kcal = Math.max(floor, Math.round(maintenance * (1 - p.deficit / 100)));
  const protein = Math.round(Number(p.weight) * p.proteinRate);
  const fat = Math.round(kcal * 0.28 / 9);
  const carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  if (carbs < 50) throw new Error('These settings leave too little room for a balanced plan. Reduce the deficit or protein target.');
  return { kcal, protein, carbs, fat, fiber: Math.round(kcal / 1000 * 14), bmr: Math.round(bmr), maintenance, deficit: maintenance - kcal, floorApplied: kcal === floor, bmi: +bmi.toFixed(1) };
}
export function totals(items: (Food & { grams: number })[]) {
  return Object.fromEntries(nutrients.map(n => [n, +items.reduce((a, f) => a + f[n] * f.grams / 100, 0).toFixed(1)]));
}
// Bounded coordinate descent over ingredient grams. Multiple food rotations give
// useful alternatives; infeasibility is reported explicitly through residuals.
export function generatePlan(p: Profile, foods: Food[], variation = 0) {
  const target = targets(p);
  const selected = foods.filter(f => p.favorites.includes(f.id) && !p.excluded.includes(f.id) && f.category !== 'Supplement');
  if (!selected.length) throw new Error('Select some preferred foods in the food library first.');
  const rotate = (arr: Food[]) => arr.length ? arr[((variation % arr.length) + arr.length) % arr.length] : null;
  const primary = rotate(selected.filter(f => ['Non-veg', 'Dairy & alternatives'].includes(f.category)));
  const legume = rotate(selected.filter(f => f.category === 'Legumes'));
  const grain = rotate(selected.filter(f => f.category === 'Grains'));
  const pool = selected.filter(f => !['Non-veg', 'Dairy & alternatives', 'Legumes', 'Grains'].includes(f.category) || [primary?.id, legume?.id, grain?.id].includes(f.id));
  const whey = foods.find(f => f.category === 'Supplement' && p.favorites.includes(f.id) && !p.excluded.includes(f.id));
  const fixed = p.wheyGrams > 0 && whey ? [{ ...whey, grams: Math.min(p.wheyGrams, whey.maxGrams) }] : [];
  const fixedTotals = totals(fixed);
  const weights: Record<Nutrient, number> = { kcal: 3, protein: 3, carbs: 1, fat: 1.5, fiber: 1.5 };
  const grams = pool.map(f => ['Vegetables', 'Greens'].includes(f.category) ? Math.min(80, f.maxGrams) : 0);
  const minimum = pool.map(f => ['Vegetables', 'Greens'].includes(f.category) ? Math.min(60, f.maxGrams) : 0);
  const current = Object.fromEntries(nutrients.map(n => [n, fixedTotals[n] + pool.reduce((s, f, i) => s + f[n] * grams[i] / 100, 0)])) as Record<Nutrient, number>;
  for (let pass = 0; pass < 600; pass++) {
    let moved = 0;
    for (let i = 0; i < pool.length; i++) {
      let numerator = 0, denominator = 0;
      for (const n of nutrients) {
        const scale = weights[n] / Math.max(target[n], 1) ** 2;
        const contribution = pool[i][n] / 100;
        numerator += scale * contribution * (target[n] - current[n]);
        denominator += scale * contribution ** 2;
      }
      if (!denominator) continue;
      const next = Math.max(minimum[i], Math.min(pool[i].maxGrams, grams[i] + numerator / denominator));
      const delta = next - grams[i];
      for (const n of nutrients) current[n] += pool[i][n] * delta / 100;
      grams[i] = next;
      moved += Math.abs(delta);
    }
    if (moved < 0.01) break;
  }
  const items = [...pool.map((f, i) => ({ ...f, grams: Math.round(grams[i]) })).filter(f => f.grams > 0), ...fixed];
  const actual = totals(items);
  const gaps = nutrients.map(n => ({ nutrient: n, delta: +(actual[n] - target[n]).toFixed(1), percent: Math.round((actual[n] - target[n]) / target[n] * 100) }));
  const warnings = [];
  if (gaps.some(g => Math.abs(g.percent) > (g.nutrient === 'fiber' ? 25 : 12))) warnings.push('Some targets could not be matched within the selected foods and daily portion limits. Add more food variety, adjust limits, or try another combination.');
  if (p.wheyGrams && !whey) warnings.push('Whey was requested but no preferred, non-excluded supplement is available. Select whey in your food library.');
  if (fixed[0] && fixed[0].grams < p.wheyGrams) warnings.push('Whey is capped at its food-library daily limit.');
  if (target.floorApplied) warnings.push('The calorie target was raised to the app’s conservative floor. The actual deficit may be smaller than requested.');
  if (actual.kcal < (p.sex === 'male' ? 1500 : 1200)) warnings.push('This combination is below the app’s calorie floor. It is incomplete and should not be used as a full day of food. Add suitable foods and regenerate.');
  const needsAdjustment = gaps.some(g => Math.abs(g.percent) > (g.nutrient === 'fiber' ? 25 : 12)) || actual.kcal < (p.sex === 'male' ? 1500 : 1200);
  return { target, items, actual, gaps, warnings, variation, needsAdjustment };
}
export function workout(p: Profile) {
  const gym = p.equipment === 'gym';
  const a = [gym ? 'Goblet squat or leg press' : 'Bodyweight squat', gym ? 'Dumbbell bench press' : 'Incline push-up', gym ? 'Seated cable row' : 'Resistance-band row', 'Romanian deadlift', 'Plank'];
  const b = ['Split squat', gym ? 'Lat pulldown' : 'Resistance-band pulldown', gym ? 'Dumbbell overhead press' : 'Light dumbbell press', 'Glute bridge', 'Dead bug'];
  const count = Number(p.trainingDays || 3);
  const strengthIndices = count === 2 ? [0, 3] : count === 4 ? [0, 1, 3, 4] : [0, 2, 4];
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, i) => {
    const s = strengthIndices.indexOf(i);
    if (s >= 0) return { day, type: 'Strength', title: `Full body ${s % 2 ? 'B' : 'A'}`, detail: 'Warm up 5–10 min · leave 2–3 reps in reserve', exercises: (s % 2 ? b : a).map((name, index) => ({ name, dose: index === 4 ? '2 × 20–30 sec / side' : `${p.experience === 'intermediate' ? 3 : 2} × 8–12 reps` })) };
    return { day, type: i === 6 ? 'Recovery' : i === 5 ? 'Swim' : 'Cardio', title: i === 6 ? 'Rest & easy mobility' : i === 5 ? 'Comfortable swim' : 'Brisk walk or cycle', detail: i === 6 ? 'An easy walk is optional. Prioritize sleep.' : 'Start with 20–30 min at a conversational pace.', exercises: [] };
  });
}
