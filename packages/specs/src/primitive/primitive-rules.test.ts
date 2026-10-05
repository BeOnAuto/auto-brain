import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const header = [
  "import * as Operations from '@beonauto/operations';",
  'export const { Caller, Conflict, InvalidInput, NotFound, Unavailable } = Operations;',
  "import { Effect } from 'effect';",
  "import { definePrimitive } from '../../../src/index.ts';",
  "export const about = { name: 'probe', title: 'Probe', description: 'Probe.', noun: { one: 'probe', other: 'probes' }, describeOutput: () => 'Probed.', mediaType: 'text/plain' };",
  "export const parse = (source: string) => Effect.succeed({ lines: source.split('\\n') });",
  "export const summarize = () => ({ description: 'Probe' });",
];

function defined(lines: readonly string[]): readonly string[] {
  return [...header, 'export const probe = definePrimitive({', '  ...about,', ...lines, '});'];
}

const answering = '  execute: () => Effect.succeed({ output: null, record: {} }),';

const accepted: Readonly<Record<string, readonly string[]>> = {
  'parsed-value-flows.ts': defined([
    '  parse,',
    "  summarize: ({ lines }) => ({ description: lines.join(' '), inputSchema: { type: 'object' } }),",
    '  execute: ({ lines }, input, { spec }) =>',
    '    Effect.succeed({ output: { lines: [...lines], input, version: spec.version }, record: { count: lines.length } }),',
  ]),
  'declared-rejections.ts': defined([
    "  parse: (source: string) => source === '' ? Effect.fail(new InvalidInput({ detail: 'empty', issues: [] })) : parse(source),",
    '  summarize,',
    '  execute: ({ lines }) =>',
    "    lines.length > 2 ? Effect.fail(new Conflict({ detail: 'cannot run as written' })) :",
    "    lines.length > 1 ? Effect.fail(new Unavailable({ detail: 'busy' })) : Effect.fail(new InvalidInput({ detail: 'no', issues: [] })),",
  ]),
  'finishes-later.ts': defined([
    '  parse,',
    '  summarize,',
    '  execute: (_parsed, _input, { id }) => Effect.succeed({ finishesLater: true, record: { run: id } }),',
  ]),
};

interface Rejection {
  readonly because: string;
  readonly source: readonly string[];
}

const rejected: Readonly<Record<string, Rejection>> = {
  'summarize-expects-another-value.ts': {
    because: "Property 'words' is missing",
    source: defined([
      '  parse,',
      '  summarize: ({ words }: { words: string[] }) => ({ description: words[0] }),',
      answering,
    ]),
  },
  'execute-expects-another-value.ts': {
    because: "Property 'size' is missing",
    source: defined([
      '  parse,',
      '  summarize,',
      '  execute: ({ size }: { size: number }) => Effect.succeed({ output: size, record: {} }),',
    ]),
  },
  'parse-rejects-undeclared.ts': {
    because: "Property 'issues' is missing in type 'Unavailable'",
    source: defined([
      "  parse: (source: string) => source === '' ? Effect.fail(new Unavailable({ detail: 'busy' })) : parse(source),",
      '  summarize,',
      answering,
    ]),
  },
  'execute-rejects-undeclared.ts': {
    because: "Type 'NotFound' is not assignable to type 'PrimitiveRejection'",
    source: defined(['  parse,', '  summarize,', "  execute: () => Effect.fail(new NotFound({ detail: 'gone' })),"]),
  },
  'execute-asks-a-service.ts': {
    because: "Type 'Caller' is not assignable to type 'never'",
    source: defined([
      '  parse,',
      '  summarize,',
      '  execute: () => Effect.gen(function* () { yield* Caller; return { output: null, record: {} }; }),',
    ]),
  },
  'output-not-json.ts': {
    because: "is not assignable to type 'Json'",
    source: defined([
      '  parse,',
      '  summarize,',
      '  execute: () => Effect.succeed({ output: new Date(), record: {} }),',
    ]),
  },
  'finishes-later-without-record.ts': {
    because: "Property 'record' is missing",
    source: defined(['  parse,', '  summarize,', '  execute: () => Effect.succeed({ finishesLater: true }),']),
  },
  'record-not-an-object.ts': {
    because: "Type 'string' is not assignable to type 'JsonObject'",
    source: defined(['  parse,', '  summarize,', "  execute: () => Effect.succeed({ output: null, record: 'ran' }),"]),
  },
};

const fixtureDirectory = fileURLToPath(new URL('../../node_modules/.cache/primitive-rules/', import.meta.url));

function compiledErrors(): readonly string[] {
  rmSync(fixtureDirectory, { recursive: true, force: true });
  mkdirSync(fixtureDirectory, { recursive: true });
  for (const [file, source] of Object.entries(accepted)) {
    writeFileSync(`${fixtureDirectory}${file}`, source.join('\n'));
  }
  for (const [file, { source }] of Object.entries(rejected)) {
    writeFileSync(`${fixtureDirectory}${file}`, source.join('\n'));
  }
  writeFileSync(
    `${fixtureDirectory}tsconfig.json`,
    JSON.stringify({ extends: '../../../../../tsconfig.base.json', include: ['*.ts'] }),
  );
  const compiler = fileURLToPath(new URL('bin/tsc', import.meta.resolve('typescript/package.json')));
  const { stdout } = spawnSync(process.execPath, [compiler, '--pretty', 'false'], {
    cwd: fixtureDirectory,
    encoding: 'utf8',
  });
  return stdout.split(/\n(?=\S)/u).filter((error) => error.includes('error TS'));
}

describe('the compiler', () => {
  let errors: readonly string[] = [];

  beforeAll(() => {
    errors = compiledErrors();
  }, 60_000);

  it('accepts every primitive that keeps the rules and rejects every one that breaks them', () => {
    expect(new Set(errors.map((error) => error.slice(0, error.indexOf('('))))).toEqual(new Set(Object.keys(rejected)));
  });

  it.each(Object.entries(rejected))('rejects %s for the rule it breaks', (file, { because }) => {
    expect(errors.filter((error) => error.startsWith(`${file}(`)).join('\n')).toContain(because);
  });
});
