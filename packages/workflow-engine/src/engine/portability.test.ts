import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface Forbidden {
  readonly what: string;
  readonly pattern: Readonly<RegExp>;
}

const source = fileURLToPath(new URL('..', import.meta.url));

const nodeOnly: readonly Forbidden[] = [
  { what: 'a node: module', pattern: /from ['"]node:/u },
  { what: 'a Node global', pattern: /\b(?:process|Buffer|require|setImmediate|__dirname)\b/u },
  { what: 'code generation', pattern: /\beval\(|new Function\(/u },
  { what: 'Temporal', pattern: /@temporalio\//u },
];

function isProductionSource(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts');
}

function findingsIn(file: string): readonly string[] {
  const text = readFileSync(join(source, file), 'utf8');
  return nodeOnly
    .filter(({ pattern }: Forbidden) => pattern.test(text))
    .map(({ what }: Forbidden) => `${file}: ${what}`);
}

describe('the engine core', () => {
  it('uses no Node-only API, no code generation and no Temporal, so it runs in workerd as it runs in Node', () => {
    const files = readdirSync(source, { recursive: true, encoding: 'utf8' }).filter((file) => isProductionSource(file));

    expect(files.length).toBeGreaterThan(10);
    expect(files.flatMap((file) => findingsIn(file))).toEqual([]);
  });
});
