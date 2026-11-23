// A D1-compatible wrapper around Node's built-in SQLite, for tests and the local relay.

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1Statement } from '../src/types.ts';

type Value = string | number | null | bigint | Uint8Array;

function normalize(values: unknown[]): Value[] {
  return values.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value as Value;
  });
}

export function sqliteD1(file = ':memory:', migrations: string[] = []): D1Database {
  const db = new DatabaseSync(file);
  for (const path of migrations) db.exec(readFileSync(path, 'utf8'));

  function statement(sql: string, values: Value[]): D1Statement {
    return {
      bind: (...next: unknown[]) => statement(sql, normalize(next)),
      first: async <T>() => (db.prepare(sql).get(...values) as T | undefined) ?? null,
      all: async <T>() => ({ results: db.prepare(sql).all(...values) as T[] }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
    };
  }

  return { prepare: (sql: string) => statement(sql, []) };
}
