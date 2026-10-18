import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity';

export type Value = string | number | bigint | null;
export type Row = Record<string, any>;
const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name))
    throw new Error('Invalid database identifier.');
  return `[${name}]`;
};

/** All operations share a queue. A request cannot accidentally join another
 * request's transaction, even when an awaited operation yields the event loop. */
export abstract class Driver {
  abstract readonly kind: 'sqlite' | 'azure-sql';
  private tail: Promise<unknown> = Promise.resolve();
  private readonly context = new AsyncLocalStorage<{ handle: unknown }>();
  protected abstract query(
    text: string,
    values: Value[],
    transaction?: unknown,
  ): Promise<{ rows: Row[]; changes: number }>;
  protected abstract begin(): Promise<unknown>;
  protected abstract commit(handle: unknown): Promise<void>;
  protected abstract rollback(handle: unknown): Promise<void>;
  abstract close(): Promise<void>;

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.tail.then(work, work);
    this.tail = task.catch(() => undefined);
    return task;
  }
  private execute(text: string, values: Value[]) {
    const active = this.context.getStore();
    return active
      ? this.query(text, values, active.handle)
      : this.serial(() => this.query(text, values));
  }
  prepare(text: string) {
    return {
      all: async <T extends Row = Row>(...values: Value[]) =>
        (await this.execute(text, values)).rows as T[],
      get: async <T extends Row = Row>(...values: Value[]) =>
        (await this.execute(text, values)).rows[0] as T | undefined,
      run: async (...values: Value[]) => ({
        changes: (await this.execute(text, values)).changes,
      }),
    };
  }
  async exec(text: string) {
    await this.execute(text, []);
  }
  async transaction<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.context.getStore()) return work();
    return this.serial(async () => {
      const handle = await this.begin();
      try {
        const result = await this.context.run({ handle }, work);
        await this.commit(handle);
        return result;
      } catch (error) {
        try {
          await this.rollback(handle);
        } catch {
          /* preserve the original failure */
        }
        throw error;
      }
    });
  }
  /** Serializable read/modify/write, using bound values on both engines. */
  async upsert(
    table: string,
    row: Record<string, Value>,
    keys = ['id'],
    updates = Object.keys(row).filter((c) => !keys.includes(c)),
  ) {
    const columns = Object.keys(row);
    if (
      !columns.length ||
      !keys.length ||
      keys.some((k) => !(k in row)) ||
      updates.some((k) => !(k in row))
    )
      throw new Error('Invalid upsert.');
    const where = keys.map((k) => `${identifier(k)}=?`).join(' AND ');
    return this.transaction(async () => {
      const exists = await this.prepare(
        `SELECT ${identifier(keys[0])} FROM ${identifier(table)} WHERE ${where}`,
      ).get(...keys.map((k) => row[k]));
      if (exists) {
        if (updates.length)
          await this.prepare(
            `UPDATE ${identifier(table)} SET ${updates.map((k) => `${identifier(k)}=?`).join(',')} WHERE ${where}`,
          ).run(...updates.map((k) => row[k]), ...keys.map((k) => row[k]));
      } else {
        await this.prepare(
          `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        ).run(...columns.map((k) => row[k]));
      }
    });
  }
}

export class SqliteDriver extends Driver {
  readonly kind = 'sqlite';
  private readonly connection: DatabaseSync;
  constructor(
    directory = process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  ) {
    super();
    mkdirSync(directory, { recursive: true });
    this.connection = new DatabaseSync(path.join(directory, 'nourish.sqlite'));
    this.connection.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;',
    );
  }
  protected async query(text: string, values: Value[]) {
    // exec supports the multi-statement DDL script. Bound statements never use it.
    if (!values.length && !/^\s*(SELECT|PRAGMA)/i.test(text)) {
      this.connection.exec(text);
      return { rows: [], changes: 0 };
    }
    const statement = this.connection.prepare(text);
    if (/^\s*(SELECT|PRAGMA)/i.test(text))
      return { rows: statement.all(...values) as Row[], changes: 0 };
    return { rows: [], changes: Number(statement.run(...values).changes) };
  }
  protected async begin() {
    this.connection.exec('BEGIN IMMEDIATE');
    return {};
  }
  protected async commit() {
    this.connection.exec('COMMIT');
  }
  protected async rollback() {
    this.connection.exec('ROLLBACK');
  }
  async close() {
    this.connection.close();
  }
}

/** Bind question marks outside string/identifier literals, never interpolate values. */
export function parameterize(text: string, count: number) {
  let quoted = '',
    output = '',
    index = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      output += c;
      if (c === quoted) {
        if (text[i + 1] === quoted) output += text[++i];
        else quoted = '';
      }
    } else if (c === "'" || c === '"' || c === '[') {
      quoted = c === '[' ? ']' : c;
      output += c;
    } else output += c === '?' ? `@p${index++}` : c;
  }
  if (index !== count)
    throw new Error('Database parameter count does not match.');
  return output;
}

export class AzureSqlDriver extends Driver {
  readonly kind = 'azure-sql';
  private pool?: sql.ConnectionPool;
  private tokenExpiry = 0;
  private readonly credential;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    super();
    if (!env.SQL_SERVER || !env.SQL_DATABASE)
      throw new Error('Azure SQL requires SQL_SERVER and SQL_DATABASE.');
    const auth = env.SQL_AUTH || 'managed-identity';
    if (!['managed-identity', 'azure-cli', 'password'].includes(auth))
      throw new Error('Unsupported SQL_AUTH.');
    if (
      env.NODE_ENV === 'production' &&
      (auth !== 'managed-identity' || !env.AZURE_CLIENT_ID)
    )
      throw new Error('Production Azure SQL requires its managed identity.');
    this.credential =
      auth === 'password'
        ? undefined
        : auth === 'azure-cli'
          ? new AzureCliCredential()
          : new ManagedIdentityCredential({ clientId: env.AZURE_CLIENT_ID });
  }
  private async connection(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected && Date.now() < this.tokenExpiry - 120_000)
      return this.pool;
    await this.pool?.close();
    const token = await this.credential?.getToken(
      'https://database.windows.net/.default',
    );
    this.tokenExpiry = token?.expiresOnTimestamp || Number.MAX_SAFE_INTEGER;
    const config: sql.config = {
      server: this.env.SQL_SERVER!,
      database: this.env.SQL_DATABASE!,
      port: Number(this.env.SQL_PORT || 1433),
      connectionTimeout: 30_000,
      requestTimeout: 30_000,
      pool: { min: 0, max: 2, idleTimeoutMillis: 15_000 },
      options: {
        encrypt: true,
        trustServerCertificate:
          this.env.NODE_ENV === 'test' &&
          this.env.SQL_TEST_TRUST_CERTIFICATE === 'true',
        abortTransactionOnError: true,
      },
      ...(token
        ? {
            authentication: {
              type: 'azure-active-directory-access-token' as const,
              options: { token: token.token },
            },
          }
        : { user: this.env.SQL_USER, password: this.env.SQL_PASSWORD }),
    };
    // Retry connection establishment (including database resume), never a query
    // or a transaction whose commit outcome might be unknown.
    for (let attempt = 0; ; attempt++) {
      const pool = new sql.ConnectionPool(config);
      pool.on('error', () => {
        /* individual requests report their own failures */
      });
      try {
        this.pool = await pool.connect();
        return this.pool;
      } catch (error) {
        await pool.close().catch(() => undefined);
        if (attempt >= 4) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * 2 ** attempt),
        );
      }
    }
  }
  protected async query(text: string, values: Value[], transaction?: unknown) {
    const request = transaction
      ? new sql.Request(transaction as sql.Transaction)
      : (await this.connection()).request();
    values.forEach((value, i) => {
      if (typeof value === 'number' || typeof value === 'bigint')
        request.input(
          `p${i}`,
          typeof value === 'bigint' || Number.isInteger(value)
            ? sql.BigInt
            : sql.Float,
          value,
        );
      else request.input(`p${i}`, sql.NVarChar(sql.MAX), value);
    });
    const result = await request.query(parameterize(text, values.length));
    return {
      rows: (result.recordset || []) as Row[],
      changes: result.rowsAffected.reduce((a, b) => a + b, 0),
    };
  }
  protected async begin() {
    const transaction = new sql.Transaction(await this.connection());
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    return transaction;
  }
  protected async commit(transaction: unknown) {
    await (transaction as sql.Transaction).commit();
  }
  protected async rollback(transaction: unknown) {
    await (transaction as sql.Transaction).rollback();
  }
  async close() {
    await this.pool?.close();
  }
}

export function createDriver() {
  const provider = process.env.DATABASE_PROVIDER || 'sqlite';
  if (provider === 'sqlite') return new SqliteDriver();
  if (provider === 'azure-sql') return new AzureSqlDriver();
  throw new Error('Unsupported DATABASE_PROVIDER.');
}
