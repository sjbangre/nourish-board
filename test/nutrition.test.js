import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, validateFood, targets, generatePlan, totals, defaultPreferences, workout } from '../apps/api/dist/nutrition/engine.js';
import { starterFoods } from '../apps/api/dist/foods/catalog.js';

const fixture = (changes = {}) => validateProfile({ name: 'Test adult', sex: 'male', age: 35, height: 175, weight: 80, goalWeight: 72, activity: 1.55, deficit: 15, proteinRate: 1.6, wheyGrams: 0, trainingDays: 3, equipment: 'gym', experience: 'beginner', favorites: defaultPreferences, ...changes });

test('energy equation, deficit, and macro energy budget are consistent', () => {
  const t = targets(fixture());
  assert.equal(t.bmr, 1724);
  assert.equal(t.maintenance, 2672);
  assert.equal(t.kcal, 2271);
  assert.equal(t.protein, 128);
  assert.ok(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.kcal) <= 4);
  assert.equal(targets(fixture({ sex: 'female' })).bmr, 1558);
});
test('missing, unsupported, and unsafe profile values do not generate targets', () => {
  for (const changes of [{ weight: '' }, { weight: NaN }, { age: 17 }, { height: 0 }, { deficit: 50 }, { proteinRate: 4 }]) assert.throws(() => fixture(changes));
  assert.throws(() => targets({ configured: false }), /Set up/);
  assert.throws(() => targets(fixture({ needsReview: true })), /paused/);
  assert.throws(() => targets(fixture({ height: 180, weight: 50, goalWeight: 45 })), /BMI/);
  assert.throws(() => targets(fixture({ goalWeight: 90 })), /higher goal/);
});
test('calorie floor reduces the actual deficit instead of prescribing below the floor', () => {
  const p = fixture({ sex: 'female', height: 150, weight: 50, goalWeight: 48, age: 60, activity: 1.2, deficit: 20 });
  const t = targets(p);
  assert.equal(t.kcal, 1200);
  assert.equal(t.floorApplied, true);
  assert.equal(t.deficit, t.maintenance - 1200);
});
test('solver uses selected foods, respects portion caps, and includes whey exactly once', () => {
  const p = fixture({ wheyGrams: 30, favorites: [...defaultPreferences, 'whey'], excluded: ['eggs'] });
  const plan = generatePlan(p, starterFoods);
  for (const item of plan.items) {
    assert.ok(p.favorites.includes(item.id));
    assert.notEqual(item.id, 'eggs');
    assert.ok(item.grams > 0 && item.grams <= item.maxGrams);
  }
  assert.equal(plan.items.filter(f => f.id === 'whey').length, 1);
  assert.equal(plan.items.find(f => f.id === 'whey').grams, 30);
  assert.deepEqual(plan.actual, totals(plan.items));
  for (const n of ['kcal', 'protein', 'carbs', 'fat', 'fiber']) assert.ok(Math.abs(plan.actual[n] / plan.target[n] - 1) < 0.12, `${n} should be reasonably close with a balanced pantry`);
});
test('alternative combinations rotate staples without adding unselected ingredients', () => {
  const p = fixture();
  const one = generatePlan(p, starterFoods, 0), two = generatePlan(p, starterFoods, 1);
  assert.ok(one.items.some(f => f.id === 'chicken'));
  assert.ok(two.items.some(f => f.id === 'eggs'));
  assert.ok(!two.items.some(f => f.id === 'chicken'));
});
test('restricted pantry reports infeasibility and missing whey instead of inventing foods', () => {
  const p = fixture({ favorites: ['spinach'], wheyGrams: 30 });
  const plan = generatePlan(p, starterFoods);
  assert.deepEqual(plan.items.map(f => f.id), ['spinach']);
  assert.ok(plan.warnings.some(w => w.includes('could not be matched')));
  assert.ok(plan.warnings.some(w => w.includes('Whey was requested')));
  assert.throws(() => generatePlan(fixture({ favorites: [] }), starterFoods), /Select some/);
});
test('nutrition labels and servings reject invalid values', () => {
  const food = starterFoods[0];
  assert.throws(() => validateFood({ ...food, protein: -1 }));
  assert.throws(() => validateFood({ ...food, maxGrams: 0 }));
  assert.throws(() => validateFood({ ...food, kcal: '' }));
});
test('training respects selected strength days and preserves swimming and recovery', () => {
  for (const n of [2, 3, 4]) {
    const week = workout(fixture({ trainingDays: n }));
    assert.equal(week.length, 7);
    assert.equal(week.filter(d => d.type === 'Strength').length, n);
    assert.equal(week.find(d => d.day === 'Saturday').type, 'Swim');
    assert.equal(week.find(d => d.day === 'Sunday').type, 'Recovery');
  }
});
