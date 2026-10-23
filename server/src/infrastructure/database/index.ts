import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    const migrations = new URL('../../../migrations/', import.meta.url);
    const apply = db.transaction(() => {
      for (const name of readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort()) {
        if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name)) continue;
        db.exec(readFileSync(new URL(name, migrations), 'utf8'));
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      }
    });
    apply();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
