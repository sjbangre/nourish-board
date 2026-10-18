import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { starterFoods } from '../apps/api/dist/foods/catalog.js';

test('legacy SQLite data migrates idempotently without losing measurements or edited foods', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nourish-migration-'));
  const db = new DatabaseSync(path.join(dir, 'nourish.sqlite'));
  const previous = process.env.DATA_DIR; process.env.DATA_DIR = dir;
  try {
    db.exec('CREATE TABLE profiles(id TEXT PRIMARY KEY,body TEXT NOT NULL)');
    db.exec('CREATE TABLE foods(id TEXT PRIMARY KEY,body TEXT NOT NULL)');
    db.prepare('INSERT INTO profiles VALUES (?,?)').run('me', JSON.stringify({ id: 'me', name: 'Existing', weight: 83.2, favorites: ['eggs'], configured: true }));
    db.prepare('INSERT INTO foods VALUES (?,?)').run('chicken', JSON.stringify({ ...starterFoods[0], kcal: 135, source: 'My edited label' }));
    db.close();
    let service = new DatabaseService(); service.onModuleDestroy(); service = new DatabaseService();
    const migrated = service.profiles()[0];
    assert.equal(migrated.weight, 83.2);
    assert.deepEqual(migrated.favorites, ['eggs']);
    assert.equal(migrated.familyId, 'family-default');
    assert.equal(migrated.coupleId, 'couple-default');
    assert.equal(service.families().length, 1);
    assert.equal(service.foods().find(f => f.id === 'chicken').kcal, 135);
    assert.equal(service.foods().length, 120);
    service.onModuleDestroy();
  } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; await rm(dir, { recursive: true, force: true }); }
});
test('expanded catalog has unique IDs, regional foods, and Bengaluru-market fruit choices', () => {
  assert.equal(new Set(starterFoods.map(f => f.id)).size, starterFoods.length);
  assert.ok(starterFoods.length >= 100);
  assert.ok(starterFoods.filter(f => f.category === 'Fruit').length >= 20);
  for (const id of ['ragi', 'toor', 'urad', 'field-beans', 'bottle-gourd', 'drumstick-leaves', 'sapota', 'mosambi', 'papaya']) assert.ok(starterFoods.some(f => f.id === id));
});
