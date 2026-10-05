import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const runtimeImport = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?\bfrom\s+'([^']+)'/gmu;

function importsOf(file: string): readonly string[] {
  const specifiers: string[] = [];
  for (const match of readFileSync(file, 'utf8').matchAll(runtimeImport)) {
    specifiers.push(String(match[1]));
  }
  return specifiers;
}

function packagesReachableFrom(entry: string): ReadonlySet<string> {
  const visited = new Set<string>();
  const packages = new Set<string>();
  const pending = [join(import.meta.dirname, entry)];
  while (pending.length > 0) {
    const file = String(pending.pop());
    const specifiers = visited.has(file) ? [] : importsOf(file);
    visited.add(file);
    pending.push(
      ...specifiers.filter((specifier) => specifier.startsWith('.')).map((relative) => join(dirname(file), relative)),
    );
    for (const name of specifiers.filter((specifier) => !specifier.startsWith('.'))) {
      packages.add(name);
    }
  }
  return packages;
}

describe('the ledger entry points', () => {
  it('keep the main entry free of native and Node-only modules', () => {
    const packages = [...packagesReachableFrom('index.ts')];

    expect(packages.filter((name) => name.startsWith('node:'))).toEqual([]);
    expect(packages.filter((name) => name.includes('sqlite3'))).toEqual([]);
    expect(packages).not.toContain('pg');
    expect(packages.filter((name) => name.includes('postgresql'))).toEqual([]);
    expect(packages).toContain('@event-driven-io/emmett-sqlite');
  });

  it('keep the PostgreSQL event store and its driver behind the postgresql entry', () => {
    const packages = [...packagesReachableFrom('postgresql/postgresql-ledger.ts')];

    expect(packages).toContain('@event-driven-io/emmett-postgresql');
    expect(packages).toContain('@event-driven-io/emmett-postgresql/pg');
    expect(packages.filter((name) => name.includes('sqlite'))).toEqual([]);
  });

  it('keep the sqlite3 driver and the file system behind the sqlite3 entry', () => {
    const packages = packagesReachableFrom('sqlite3.ts');

    expect(packages).toContain('@event-driven-io/emmett-sqlite/sqlite3');
    expect(packages).toContain('node:fs');
  });
});
