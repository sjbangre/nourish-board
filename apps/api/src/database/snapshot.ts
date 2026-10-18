import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Driver, Row, Value } from './driver';

// Dependency order also defines the complete portable migration format.
export const tables = {
  families: ['id', 'name', 'archived_at'],
  users: ['id', 'google_id', 'email', 'name', 'role', 'status'],
  profiles: ['id', 'body'],
  foods: ['id', 'body'],
  couples: ['id', 'family_id', 'name'],
  memberships: ['user_id', 'family_id'],
  invitations: [
    'id',
    'email',
    'family_id',
    'approved_by',
    'created_at',
    'status',
  ],
  plans: ['profile_id', 'body'],
  logs: ['id', 'profile_id', 'day', 'weight', 'note'],
} as const;
export type Snapshot = {
  format: 1;
  tables: Record<keyof typeof tables, Row[]>;
};
const keys = (table: string) =>
  table === 'memberships'
    ? ['user_id', 'family_id']
    : table === 'plans'
      ? ['profile_id']
      : ['id'];

export function exportSqlite(file: string): Snapshot {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('BEGIN'); // consistent WAL snapshot without stopping the local app
    const data = Object.fromEntries(
      Object.entries(tables).map(([table, columns]) => [
        table,
        db
          .prepare(
            `SELECT ${columns.join(',')} FROM ${table} ORDER BY ${keys(table).join(',')}`,
          )
          .all(),
      ]),
    );
    db.exec('COMMIT');
    return { format: 1, tables: data as Snapshot['tables'] };
  } finally {
    db.close();
  }
}

export function encodeSnapshot(snapshot: Snapshot) {
  return gzipSync(JSON.stringify(snapshot)).toString('base64');
}
export function decodeSnapshot(encoded: string): Snapshot {
  if (!/^[A-Za-z0-9+/=]+$/.test(encoded))
    throw new Error('Invalid migration snapshot encoding.');
  const snapshot = JSON.parse(
    gunzipSync(Buffer.from(encoded, 'base64'), {
      maxOutputLength: 16 * 1024 * 1024,
    }).toString(),
  );
  validateSnapshot(snapshot);
  return snapshot;
}
export function validateSnapshot(snapshot: Snapshot) {
  if (
    snapshot?.format !== 1 ||
    !snapshot.tables ||
    Object.keys(snapshot.tables).sort().join() !==
      Object.keys(tables).sort().join()
  )
    throw new Error('Unsupported migration snapshot.');
  for (const [table, columns] of Object.entries(tables)) {
    const rows = snapshot.tables[table as keyof typeof tables];
    if (!Array.isArray(rows) || rows.length > 100_000)
      throw new Error('Invalid migration table.');
    for (const row of rows) {
      if (
        !row ||
        Object.keys(row).sort().join() !== [...columns].sort().join() ||
        Object.values(row).some(
          (value) =>
            value !== null &&
            typeof value !== 'string' &&
            !(typeof value === 'number' && Number.isFinite(value)),
        )
      )
        throw new Error('Invalid migration row.');
      if ('body' in row) JSON.parse(row.body);
    }
  }
}

export async function importSnapshot(db: Driver, snapshot: Snapshot) {
  validateSnapshot(snapshot);
  const sourceHash = createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
  return db.transaction(async () => {
    const previous = await db
      .prepare('SELECT source_hash FROM data_imports WHERE id=?')
      .get('initial-sqlite-v1');
    if (previous) {
      if (previous.source_hash !== sourceHash)
        throw new Error(
          'A different initial dataset has already been imported; refusing to overwrite cloud data.',
        );
      return { imported: false };
    }
    for (const table of Object.keys(tables).filter(
      (table) => table !== 'foods',
    )) {
      if (await db.prepare(`SELECT ${keys(table)[0]} FROM ${table}`).get())
        throw new Error(
          'Initial migration requires an empty target. Existing cloud data was not changed.',
        );
    }
    for (const table of Object.keys(tables) as (keyof typeof tables)[]) {
      for (const row of snapshot.tables[table])
        await db.upsert(table, row as Record<string, Value>, keys(table));
    }
    await db.upsert('data_imports', {
      id: 'initial-sqlite-v1',
      source_hash: sourceHash,
      imported_at: new Date().toISOString(),
    });
    // Browser sessions and in-flight OAuth attempts deliberately do not migrate.
    return { imported: true };
  });
}
