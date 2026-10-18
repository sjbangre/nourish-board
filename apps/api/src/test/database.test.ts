import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AzureSqlDriver,
  SqliteDriver,
  parameterize,
  type Driver,
} from '../database/driver';
import { azureSqlSchema, sqliteSchema } from '../database/schema';
import { DatabaseService } from '../database/database.service';
import {
  decodeSnapshot,
  encodeSnapshot,
  exportSqlite,
  importSnapshot,
  tables,
  type Snapshot,
} from '../database/snapshot';

function dataset(): Snapshot {
  return {
    format: 1,
    tables: {
      families: [{ id: 'family', name: 'Test family', archived_at: null }],
      users: [
        {
          id: 'user',
          google_id: null,
          email: 'test@example.com',
          name: 'Test',
          role: 'member',
          status: 'active',
        },
      ],
      profiles: [
        {
          id: 'profile',
          body: JSON.stringify({ familyId: 'family', name: 'Test profile' }),
        },
      ],
      foods: [
        {
          id: 'food',
          body: JSON.stringify({ name: 'Green gram', protein: 24 }),
        },
      ],
      couples: [{ id: 'couple', family_id: 'family', name: 'Test couple' }],
      memberships: [{ user_id: 'user', family_id: 'family' }],
      invitations: [],
      plans: [
        { profile_id: 'profile', body: JSON.stringify({ calories: 1800 }) },
      ],
      logs: [
        {
          id: 'log',
          profile_id: 'profile',
          day: '2026-10-18',
          weight: 80.5,
          note: 'Test',
        },
      ],
    },
  };
}

test('SQL parameters preserve literal question marks and reject count mismatches', () => {
  assert.equal(
    parameterize(
      `SELECT '?', 'it''s ?', [why?], "what?" WHERE id=? AND name=?`,
      2,
    ),
    `SELECT '?', 'it''s ?', [why?], "what?" WHERE id=@p0 AND name=@p1`,
  );
  assert.throws(() => parameterize('SELECT ?', 0), /parameter count/);
  assert.throws(() => parameterize('SELECT 1', 1), /parameter count/);
});

test('snapshot codec rejects unexpected tables, columns, values and malformed JSON', () => {
  const source = dataset();
  assert.deepEqual(decodeSnapshot(encodeSnapshot(source)), source);
  assert.throws(() => decodeSnapshot('not base64!'));
  for (const mutate of [
    (s: any) => {
      s.tables.sessions = [];
    },
    (s: any) => {
      s.tables.families[0].unexpected = 'value';
    },
    (s: any) => {
      s.tables.families[0].name = {};
    },
    (s: any) => {
      s.tables.foods[0].body = '{';
    },
  ]) {
    const invalid = structuredClone(source);
    mutate(invalid);
    assert.throws(() => decodeSnapshot(encodeSnapshot(invalid)));
  }
});

async function exercise(db: Driver, t: TestContext) {
  async function reset() {
    await db.exec(
      'DELETE FROM sessions; DELETE FROM oauth_attempts; DELETE FROM data_imports;',
    );
    for (const table of Object.keys(tables).reverse())
      await db.exec(`DELETE FROM ${table}`);
  }
  await t.test(
    'bound values and upsert do not execute SQL embedded in user text',
    async () => {
      const text = `Test'); DROP TABLE families; -- ? ಕನ್ನಡ`;
      await db.upsert('families', {
        id: 'family',
        name: text,
        archived_at: null,
      });
      assert.equal(
        (await db.prepare('SELECT name FROM families WHERE id=?').get('family'))
          ?.name,
        text,
      );
      await db.upsert('families', {
        id: 'family',
        name: 'Updated',
        archived_at: null,
      });
      await db.upsert(
        'families',
        { id: 'family', name: 'Ignored', archived_at: null },
        ['id'],
        [],
      );
      assert.equal(
        (await db.prepare('SELECT name FROM families WHERE id=?').get('family'))
          ?.name,
        'Updated',
      );
      await assert.rejects(
        db.upsert('families; DROP TABLE users', { id: 'unsafe' }),
        /identifier/,
      );
    },
  );
  await reset();
  await t.test(
    'failed nested work rolls back the entire transaction',
    async () => {
      await assert.rejects(
        db.transaction(async () => {
          await db.upsert('families', {
            id: 'rolled-back',
            name: 'Rollback',
            archived_at: null,
          });
          await db.transaction(async () => {
            throw new Error('intentional rollback');
          });
        }),
        /intentional rollback/,
      );
      assert.equal(
        await db.prepare('SELECT id FROM families').get(),
        undefined,
      );
      await db.upsert('families', {
        id: 'after-rollback',
        name: 'Usable',
        archived_at: null,
      });
    },
  );
  await reset();
  await t.test(
    'another request waits outside an uncommitted transaction',
    async () => {
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const transaction = db.transaction(async () => {
        await db.upsert('families', {
          id: 'temporary',
          name: 'Temporary',
          archived_at: null,
        });
        started();
        await gate;
        throw new Error('rollback temporary');
      });
      // Attach the rejection handler before releasing the transaction.
      const rolledBack = assert.rejects(transaction, /rollback temporary/);
      await entered;
      let resolved = false;
      const reader = db
        .prepare('SELECT id FROM families')
        .all()
        .then((rows) => {
          resolved = true;
          return rows;
        });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(resolved, false);
      release();
      await rolledBack;
      assert.deepEqual(await reader, []);
    },
  );
  await reset();
  await t.test(
    'initial import is atomic, preserves relationships and never overwrites later edits',
    async () => {
      const source = dataset();
      await db.upsert('foods', {
        id: 'food',
        body: JSON.stringify({ name: 'Catalog default' }),
      });
      assert.deepEqual(await importSnapshot(db, source), { imported: true });
      assert.equal(
        (
          await db
            .prepare('SELECT family_id FROM memberships WHERE user_id=?')
            .get('user')
        )?.family_id,
        'family',
      );
      assert.equal(
        JSON.parse(
          (await db.prepare('SELECT body FROM foods WHERE id=?').get('food'))!
            .body,
        ).protein,
        24,
      );
      await db
        .prepare('UPDATE families SET name=? WHERE id=?')
        .run('Cloud edit', 'family');
      assert.deepEqual(await importSnapshot(db, source), { imported: false });
      assert.equal(
        (await db.prepare('SELECT name FROM families WHERE id=?').get('family'))
          ?.name,
        'Cloud edit',
      );
      const changed = structuredClone(source);
      changed.tables.families[0].name = 'Different source';
      await assert.rejects(
        importSnapshot(db, changed),
        /different initial dataset/,
      );
      assert.equal(
        await db.prepare('SELECT token_hash FROM sessions').get(),
        undefined,
      );
    },
  );
  await reset();
  await t.test(
    'import refuses an existing target and rolls back invalid foreign keys',
    async () => {
      await db.upsert('families', {
        id: 'existing',
        name: 'Keep me',
        archived_at: null,
      });
      await assert.rejects(importSnapshot(db, dataset()), /empty target/);
      assert.equal(
        (
          await db
            .prepare('SELECT name FROM families WHERE id=?')
            .get('existing')
        )?.name,
        'Keep me',
      );
      await reset();
      const invalid = dataset();
      invalid.tables.memberships[0].family_id = 'missing';
      await assert.rejects(importSnapshot(db, invalid));
      assert.equal(
        await db.prepare('SELECT id FROM families').get(),
        undefined,
      );
      assert.equal(
        await db.prepare('SELECT id FROM data_imports').get(),
        undefined,
      );
    },
  );
}

test('SQLite driver and migration contract', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nourish-driver-'));
  const db = new SqliteDriver(directory);
  try {
    await db.exec(sqliteSchema);
    await db.exec('ALTER TABLE families ADD COLUMN archived_at TEXT');
    await exercise(db, t);
    await importSnapshot(db, dataset());
    assert.deepEqual(
      decodeSnapshot(
        encodeSnapshot(exportSqlite(path.join(directory, 'nourish.sqlite'))),
      ),
      dataset(),
    );
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'SQL Server driver and migration contract',
  { skip: process.env.SQL_INTEGRATION !== 'true' },
  async (t) => {
    const admin = new AzureSqlDriver({
      ...process.env,
      NODE_ENV: 'test',
      SQL_AUTH: 'password',
      SQL_DATABASE: 'master',
    });
    try {
      await admin.exec(
        "IF DB_ID(N'nourish_integration') IS NULL CREATE DATABASE nourish_integration;",
      );
    } finally {
      await admin.close();
    }
    const db = new AzureSqlDriver({
      ...process.env,
      NODE_ENV: 'test',
      SQL_AUTH: 'password',
      SQL_DATABASE: 'nourish_integration',
    });
    try {
      await db.exec(azureSqlSchema);
      await exercise(db, t);
    } finally {
      await db.close();
    }
    const previous = {
      DATABASE_PROVIDER: process.env.DATABASE_PROVIDER,
      DATABASE_MIGRATIONS: process.env.DATABASE_MIGRATIONS,
      SQL_DATABASE: process.env.SQL_DATABASE,
    };
    try {
      process.env.DATABASE_PROVIDER = 'azure-sql';
      process.env.DATABASE_MIGRATIONS = 'on';
      process.env.SQL_DATABASE = 'nourish_integration';
      const migration = new DatabaseService();
      try {
        await migration.ready;
        assert.ok((await migration.foods()).length >= 100);
        assert.deepEqual(await migration.profiles(), []);
        assert.ok(
          await migration.db
            .prepare('SELECT version FROM schema_migrations WHERE version=4')
            .get(),
        );
      } finally {
        await migration.onModuleDestroy();
      }
      process.env.DATABASE_MIGRATIONS = 'off';
      const runtime = new DatabaseService();
      try {
        await runtime.ready;
        assert.ok((await runtime.foods()).length >= 100);
        // A stale database cannot silently start with an incompatible schema.
        await runtime.db
          .prepare('DELETE FROM schema_migrations WHERE version=?')
          .run(4);
      } finally {
        await runtime.onModuleDestroy();
      }
      const stale = new DatabaseService();
      try {
        await assert.rejects(stale.ready, /not initialized/);
      } finally {
        await stale.onModuleDestroy();
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);
