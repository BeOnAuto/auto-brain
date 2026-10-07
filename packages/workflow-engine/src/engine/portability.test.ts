import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkExpression } from '../dsl/expressions.ts';

interface Forbidden {
  readonly what: string;
  readonly pattern: Readonly<RegExp>;
}

const source = fileURLToPath(new URL('..', import.meta.url));

const importedEverywhere: ReadonlySet<string> = new Set(['effect', '@beonauto/operations', '@beonauto/ledger']);

const importedInTheEvaluator: ReadonlySet<string> = new Set(['@gabrielbryk/jq-ts']);

const importedInThePool: ReadonlySet<string> = new Set(['node:worker_threads']);

const importSpecifier = /^\s*(?:import|export)\s(?:[^;'"]*?\bfrom\s*)?['"]([^'"]+)['"]/gmu;

function specifiersIn(text: string): readonly string[] {
  return [...text.matchAll(importSpecifier)].map(([, specifier = '']: readonly string[]) => specifier);
}

function isOwnFile(file: string, specifier: string): boolean {
  return /^\.{1,2}\//u.test(specifier) && !normalize(join(dirname(file), specifier)).startsWith('..');
}

function isAllowedImport(file: string, specifier: string): boolean {
  return (
    isOwnFile(file, specifier) ||
    importedEverywhere.has(specifier) ||
    (file.startsWith('programs/') && importedInTheEvaluator.has(specifier)) ||
    (file.startsWith('program-pool/') && importedInThePool.has(specifier))
  );
}

function importsOutsideTheAllowList(file: string, text: string): readonly string[] {
  return specifiersIn(text)
    .filter((specifier) => !isAllowedImport(file, specifier))
    .map((specifier) => `${file}: ${specifier}`);
}

const hostOnly: readonly Forbidden[] = [
  { what: 'a dynamic import', pattern: /\bimport\(/u },
  { what: 'a Node global', pattern: /\b(?:process|Buffer|require|setImmediate|__dirname)\b/u },
  { what: 'code generation', pattern: /\beval\(|new Function\(/u },
  { what: 'a host timer', pattern: /\bset(?:Timeout|Interval)\(/u },
];

const clockOrRandom: readonly Forbidden[] = [
  { what: 'the clock', pattern: /\bDate\.now\(|\bperformance\.now\(|\bTemporal\.Now\b/u },
  { what: 'a random source', pattern: /\bMath\.random\(|\bcrypto\.getRandomValues\(|\brandomUUID\(/u },
];

const impure: readonly Forbidden[] = [
  ...clockOrRandom,
  { what: 'a date of the host', pattern: /\bnew Date\b/u },
  { what: 'the host locale or time zone', pattern: /\bIntl\./u },
];

const blockComments = /\/\*[\s\S]*?\*\//gu;

const localTimeBuiltins = /Builtin\("\w+", false\)/gu;

const jqForImport = fileURLToPath(import.meta.resolve('@gabrielbryk/jq-ts'));

const jq = readFileSync(jqForImport, 'utf8').replaceAll(blockComments, '');

const jqForRequire = readFileSync(join(dirname(jqForImport), 'index.cjs'), 'utf8');

const patchOfJq = readFileSync(
  fileURLToPath(new URL('../../../../patches/@gabrielbryk__jq-ts@1.7.0.patch', import.meta.url)),
  'utf8',
);

function linesThePatchAddsTo(file: string): readonly string[] {
  const section = patchOfJq.split('diff --git ').find((part) => part.startsWith(`a/dist/${file} `)) ?? '';
  return section
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

const growingCache: readonly Forbidden[] = [
  {
    what: 'a module-level collection',
    pattern: /^(?:export )?const \w+(?:: [^=]+)? = new (?:Map|Set)(?:<[^>]*>)?\(\);/mu,
  },
  { what: 'a module-level variable', pattern: /^(?:export )?let /mu },
  { what: 'a module-level list', pattern: /^(?:export )?const \w+(?:: [^=]+)? = \[\];/mu },
];

function isProductionSource(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts') && !/^(?:[\w-]+-)?testing\//u.test(file);
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

const expressionCall = /(?<!function )\brunExpression\(([^()]*)\)/gu;

function expressionCallsIn(text: string): readonly string[] {
  return [...text.matchAll(expressionCall)].map(([, call = '']: readonly string[]) => call);
}

function expressionCallsUnder(files: readonly string[]): readonly string[] {
  return files.flatMap((file) =>
    expressionCallsIn(readFileSync(join(source, file), 'utf8')).map((call) => `${file}: ${call}`),
  );
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

const nodeHosted = ['dsl.ts', 'job-loop.ts', 'program-pool/', 'workers/'];

const portableSources = everySource.filter((file) => !nodeHosted.some((hosted) => file.startsWith(hosted)));

const machineAndRunLog = ['machine', 'runner', 'tasks', 'decider', 'run-log', 'dsl', 'programs'].flatMap((folder) =>
  sourcesUnder(folder),
);

const relativeImport = /from '(\.{1,2}\/[^']+)'/gu;

function importedBy(file: string): readonly string[] {
  const text = readFileSync(join(source, file), 'utf8');
  return [...text.matchAll(relativeImport)].map(([, path = '']: readonly string[]) =>
    normalize(join(dirname(file), path)),
  );
}

function reachableFrom(entry: string): readonly string[] {
  const reached = new Set([entry]);
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    const unseen = importedBy(file).filter((imported) => !reached.has(imported));
    for (const imported of unseen) {
      reached.add(imported);
      pending.push(imported);
    }
  }
  return [...reached].toSorted();
}

const nodeOrYaml: readonly Forbidden[] = [
  { what: 'a node: module', pattern: /from ['"]node:/u },
  { what: 'the YAML parser', pattern: /from ['"]yaml['"]/u },
];

describe('the testing entry', () => {
  it('takes no Node module and no YAML parser, so a hosted adapter can run its probes, its driver and the scripted pool', () => {
    const testingEntry = reachableFrom('testing/index.ts');

    expect(testingEntry).toEqual(expect.arrayContaining(['memory/memory-ports.ts', 'pool-testing/scripted-pool.ts']));
    expect(findingsIn(testingEntry, nodeOrYaml)).toEqual([]);
  });
});

describe('the entries of the engine', () => {
  it('reach the worker pool only through the dsl and job-loop subpaths, so the main, testing and worker entries stay portable', () => {
    const dslEntry = ['program-pool/program-pool.ts', 'programs/program-compiling.ts'];

    expect(reachableFrom('dsl.ts')).toEqual(expect.arrayContaining(dslEntry));
    expect(reachableFrom('job-loop.ts')).toContain('program-pool/job-loop.ts');
    expect(reachableFrom('worker.ts')).toContain('jobs/program-answer.ts');
    for (const entry of ['index.ts', 'testing/index.ts', 'worker.ts']) {
      expect(reachableFrom(entry).filter((file) => nodeHosted.some((hosted) => file.startsWith(hosted)))).toEqual([]);
    }
  });
});

describe('the engine core', () => {
  it('imports only effect, the workspace packages it builds on and its own files, the jq library in the evaluator alone and worker threads in the pool alone', () => {
    expect(everySource.length).toBeGreaterThan(20);
    expect(
      everySource.flatMap((file) => importsOutsideTheAllowList(file, readFileSync(join(source, file), 'utf8'))),
    ).toEqual([]);
  });

  it('uses no Node global, no dynamic import, no code generation and no host timer, but for the timers of the worker pool', () => {
    expect(portableSources.length).toBeGreaterThan(20);
    expect(findingsIn(portableSources, hostOnly)).toEqual([]);
    expect(findingsIn(sourcesUnder('program-pool'), hostOnly).toSorted()).toEqual([
      'program-pool/pool-slots.ts: a host timer',
      'program-pool/pool-threads.ts: a host timer',
    ]);
    expect(sourcesUnder('workers').length).toBeGreaterThan(1);
    expect(findingsIn(sourcesUnder('workers'), hostOnly)).toEqual([]);
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

  it('evaluate expressions with work as their only budget, so no deadline makes them read a clock', () => {
    expect(expressionCallsUnder(everySource)).toEqual([
      'dsl/evaluation.ts: source, data, variables, { now: place.now, mostWork }',
    ]);
  });
});

describe('the jq library the machine runs expressions with', () => {
  it('imports nothing, uses no Node-only API, no code generation and no host timer, and reads no clock or random source', () => {
    expect(jq.length).toBeGreaterThan(100_000);
    expect(specifiersIn(jq)).toEqual([]);
    expect(caught(jq, [...hostOnly, ...clockOrRandom])).toEqual([]);
  });

  it('is patched the same in the build require() loads as in the one import loads', () => {
    const added = linesThePatchAddsTo('index.mjs');

    expect(added.length).toBeGreaterThan(200);
    expect(added.filter((line) => !jqForRequire.includes(line))).toEqual([]);
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
      importsOutsideTheAllowList(
        'machine/m.ts',
        "import { x } from 'fs';\nimport { y } from 'node:fs';\nimport type { W } from '@temporalio/workflow';\nimport { compile } from '@gabrielbryk/jq-ts';\nimport { Worker } from 'node:worker_threads';\nimport { Effect } from 'effect';\nimport { z } from '../dsl/z.ts';\nimport { w } from '../../../ledger/src/w.ts';\nimport 'yaml';",
      ),
    ).toEqual([
      'machine/m.ts: fs',
      'machine/m.ts: node:fs',
      'machine/m.ts: @temporalio/workflow',
      'machine/m.ts: @gabrielbryk/jq-ts',
      'machine/m.ts: node:worker_threads',
      'machine/m.ts: ../../../ledger/src/w.ts',
      'machine/m.ts: yaml',
    ]);
    expect(importsOutsideTheAllowList('programs/p.ts', "import { compile } from '@gabrielbryk/jq-ts';")).toEqual([]);
    expect(
      importsOutsideTheAllowList('program-pool/p.ts', "import { W } from 'node:worker_threads';\nimport 'node:fs';"),
    ).toEqual(['program-pool/p.ts: node:fs']);
    expect(caught("const y = await import('./z.ts');\nsetTimeout(f, 1);\nprocess.exit(1);", hostOnly)).toEqual([
      'a dynamic import',
      'a Node global',
      'a host timer',
    ]);
    expect(caught('const t = Date.now();\nconst r = Math.random();\nIntl.DateTimeFormat();', impure)).toEqual([
      'the clock',
      'a random source',
      'the host locale or time zone',
    ]);
    expect(caught('const now = Temporal.Now.instant();', clockOrRandom)).toEqual(['the clock']);
    expect(
      caught('const seen = new Map<string, number>();\nlet count = 0;\nconst all: string[] = [];', growingCache),
    ).toEqual(['a module-level collection', 'a module-level variable', 'a module-level list']);
    expect(
      caught("const kinds = new Set(['a', 'b']);\nconst sizes = new WeakMap<object, number>();", growingCache),
    ).toEqual([]);
    expect(
      expressionCallsIn(
        'function runExpression(source: string) {}\nrunExpression(source, data, {}, { now, mostWork, deadline: { milliseconds: 5, clock } });',
      ),
    ).toEqual(['source, data, {}, { now, mostWork, deadline: { milliseconds: 5, clock } }']);
  });
});
