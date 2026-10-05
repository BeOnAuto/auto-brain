import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkExpression } from '../dsl/expressions.ts';

interface Forbidden {
  readonly what: string;
  readonly pattern: Readonly<RegExp>;
}

const source = fileURLToPath(new URL('..', import.meta.url));

const bareBuiltins = builtinModules.filter((name) => !name.startsWith('_')).join('|');

const nodeOnly: readonly Forbidden[] = [
  { what: 'a node: module', pattern: /from ['"]node:/u },
  { what: 'a Node module by its bare name', pattern: new RegExp(`from ['"](?:${bareBuiltins})(?:/[^'"]*)?['"]`, 'u') },
  { what: 'a dynamic import', pattern: /\bimport\(/u },
  { what: 'a Node global', pattern: /\b(?:process|Buffer|require|setImmediate|__dirname)\b/u },
  { what: 'code generation', pattern: /\beval\(|new Function\(/u },
  { what: 'a host timer', pattern: /\bset(?:Timeout|Interval)\(/u },
  { what: 'Temporal', pattern: /@temporalio\//u },
  { what: 'the Temporal global', pattern: /\bTemporal\./u },
];

const clockOrRandom: readonly Forbidden[] = [
  { what: 'the clock', pattern: /\bDate\.now\(|\bperformance\.now\(/u },
  { what: 'a random source', pattern: /\bMath\.random\(|\bcrypto\.getRandomValues\(|\brandomUUID\(/u },
];

const impure: readonly Forbidden[] = [
  ...clockOrRandom,
  { what: 'a date of the host', pattern: /\bnew Date\b/u },
  { what: 'the host locale or time zone', pattern: /\bIntl\./u },
];

const blockComments = /\/\*[\s\S]*?\*\//gu;

const localTimeBuiltins = /Builtin\("\w+", false\)/gu;

const jq = readFileSync(fileURLToPath(import.meta.resolve('@gabrielbryk/jq-ts')), 'utf8').replaceAll(blockComments, '');

const growingCache: readonly Forbidden[] = [
  {
    what: 'a module-level collection',
    pattern: /^(?:export )?const \w+(?:: [^=]+)? = new (?:Map|Set)(?:<[^>]*>)?\(\);/mu,
  },
  { what: 'a module-level variable', pattern: /^(?:export )?let /mu },
  { what: 'a module-level list', pattern: /^(?:export )?const \w+(?:: [^=]+)? = \[\];/mu },
];

function isProductionSource(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith('testing');
}

function sourcesUnder(folder: string): readonly string[] {
  return readdirSync(join(source, folder), { recursive: true, encoding: 'utf8' })
    .map((file) => join(folder, file))
    .filter((file) => isProductionSource(file));
}

function findingsIn(files: readonly string[], forbidden: readonly Forbidden[]): readonly string[] {
  return files.flatMap((file) => {
    const text = readFileSync(join(source, file), 'utf8');
    return forbidden
      .filter(({ pattern }: Forbidden) => pattern.test(text))
      .map(({ what }: Forbidden) => `${file}: ${what}`);
  });
}

function localTimeBuiltinsIn(text: string): readonly string[] {
  return (text.match(localTimeBuiltins) ?? []).map((call: string) =>
    call.slice('Builtin("'.length, call.indexOf('",')),
  );
}

function caught(text: string, forbidden: readonly Forbidden[]): readonly string[] {
  return forbidden.filter(({ pattern }: Forbidden) => pattern.test(text)).map(({ what }: Forbidden) => what);
}

const everySource = sourcesUnder('.');

const machineAndRunLog = ['machine', 'runner', 'tasks', 'decider', 'run-log', 'dsl'].flatMap((folder) =>
  sourcesUnder(folder),
);

describe('the engine core', () => {
  it('uses no Node-only API, no dynamic import, no code generation and no Temporal', () => {
    expect(everySource.length).toBeGreaterThan(20);
    expect(findingsIn(everySource, nodeOnly)).toEqual([]);
  });

  it('keeps no module-level cache that could grow with the history of a run: a collection built empty at module level is one; a constant collection of literals is not, nor a WeakMap, whose entries go with the values they describe', () => {
    expect(findingsIn(everySource, growingCache)).toEqual([]);
  });
});

describe('the machine, its runner, its tasks and its decider, the run log and the DSL', () => {
  it('read no clock, no random source and no locale, so the same state and input decide the same events', () => {
    expect(machineAndRunLog.length).toBeGreaterThan(50);
    expect(findingsIn(machineAndRunLog, impure)).toEqual([]);
  });
});

describe('the jq library the machine runs expressions with', () => {
  it('uses no Node-only API, no code generation and no host timer, and reads no clock or random source', () => {
    expect(jq.length).toBeGreaterThan(100_000);
    expect(caught(jq, [...nodeOnly, ...clockOrRandom])).toEqual([]);
  });

  it('reaches the host time zone only through localtime and strflocaltime, which the DSL refuses', () => {
    expect(localTimeBuiltinsIn(jq)).toEqual(['localtime', 'strflocaltime']);
    expect([checkExpression('now | localtime'), checkExpression('now | strflocaltime("%H")')]).toEqual([
      expect.stringContaining("localtime reads the host's time zone"),
      expect.stringContaining("strflocaltime reads the host's time zone"),
    ]);
  });
});

describe('the checks of purity', () => {
  it('catch what they are there to catch', () => {
    expect(
      caught(
        "import { x } from 'fs';\nconst y = await import('./z.ts');\nsetTimeout(f, 1);\nTemporal.Now.instant();",
        nodeOnly,
      ),
    ).toEqual(['a Node module by its bare name', 'a dynamic import', 'a host timer', 'the Temporal global']);
    expect(caught('const t = Date.now();\nconst r = Math.random();\nIntl.DateTimeFormat();', impure)).toEqual([
      'the clock',
      'a random source',
      'the host locale or time zone',
    ]);
    expect(
      caught('const seen = new Map<string, number>();\nlet count = 0;\nconst all: string[] = [];', growingCache),
    ).toEqual(['a module-level collection', 'a module-level variable', 'a module-level list']);
    expect(
      caught("const kinds = new Set(['a', 'b']);\nconst sizes = new WeakMap<object, number>();", growingCache),
    ).toEqual([]);
  });
});
