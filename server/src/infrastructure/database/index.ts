import { AsyncLocalStorage } from 'node:async_hooks';
import { readdir, readFile } from 'node:fs/promises';
import pg, { type PoolClient } from 'pg';

const migrations = new URL('../../../migrations/postgres/', import.meta.url);

export class Database {
  private readonly current = new AsyncLocalStorage<PoolClient>();

  constructor(private readonly pool: pg.Pool) {}

  async one(sql: string, ...values: unknown[]) {
    return (await this.all(sql, ...values))[0];
  }

  async all(sql: string, ...values: unknown[]) {
    return (await (this.current.getStore() ?? this.pool).query(sql, values)).rows;
  }

  async run(sql: string, ...values: unknown[]) {
    return (await (this.current.getStore() ?? this.pool).query(sql, values)).rowCount ?? 0;
  }

  async transaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.current.getStore()) return action();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Keep multi-step writes ordered as in the former single-writer database.
      await client.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()), 83381095)');
      const result = await this.current.run(client, action);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  close() { return this.pool.end(); }
}

export async function openDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    types: {
      getTypeParser(oid, format) {
        if (oid === pg.types.builtins.INT8 && format !== 'binary') return (value: string) => {
          const number = Number(value);
          if (!Number.isSafeInteger(number)) throw new Error('数据库整数超出安全范围');
          return number;
        };
        return pg.types.getTypeParser(oid, format);
      }
    }
  });
  pool.on('error', error => console.error('PostgreSQL 空闲连接异常', error.name));
  const db = new Database(pool);
  try {
    await db.transaction(async () => {
      await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      for (const name of (await readdir(migrations)).filter(file => file.endsWith('.sql')).sort()) {
        if (await db.one('SELECT 1 FROM schema_migrations WHERE name=$1', name)) continue;
        await db.run(await readFile(new URL(name, migrations), 'utf8'));
        await db.run('INSERT INTO schema_migrations(name) VALUES($1)', name);
      }
    });
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
