import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const header = [
  "import { Effect, Schema } from 'effect';",
  "import * as Operations from '../../../src/index.ts';",
  'const Empty = Schema.Record(Schema.String, Schema.Never);',
  "const about = { title: 'Probe', description: 'Probe.' };",
];

function defined(definer: 'defineQuery' | 'defineCommand', scope: 'org' | 'brain', lines: readonly string[]) {
  return [
    ...header,
    `export const probe = Operations.${definer}('${scope}', {`,
    "  ...about, name: 'probe',",
    ...lines,
    '});',
  ];
}

const get = "  route: { method: 'GET', path: '/probe' },";

const post = "  route: { method: 'POST', path: '/probe' },";

const emptyInputAndOutput = ['  inputSchema: Empty,', '  outputSchema: Empty,', '  reasons: [],'];

const answering = '  handle: () => Effect.succeed({}),';

const conflicting = "  handle: () => Effect.fail(new Operations.Conflict({ detail: 'taken' })),";

function asking(service: string): string {
  return `  handle: () => Effect.gen(function* () { yield* Operations.${service}; return {}; }),`;
}

function callingOther(definer: 'defineQuery' | 'defineCommand', route: string, service: string) {
  return [
    ...header,
    `const other = Operations.${definer}('brain', { ...about, name: 'other',`,
    route,
    ...emptyInputAndOutput,
    asking(service),
    '});',
  ];
}

function callerOfOther(definer: 'defineQuery' | 'defineCommand', route: string) {
  return [
    `export const probe = Operations.${definer}('brain', { ...about, name: 'probe',`,
    route,
    ...emptyInputAndOutput,
    '  handle: () => other.call({}),',
    '});',
  ];
}

const accepted: Readonly<Record<string, readonly string[]>> = {
  'org-command-asks-org-writer.ts': defined('defineCommand', 'org', [
    post,
    ...emptyInputAndOutput,
    asking('OrgWriter'),
  ]),
  'brain-command-asks-brain-writer.ts': defined('defineCommand', 'brain', [
    post,
    ...emptyInputAndOutput,
    asking('BrainWriter'),
  ]),
  'org-query-names-a-brain-in-its-route.ts': defined('defineQuery', 'org', [
    "  route: { method: 'GET', path: '/brains/{brain}' },",
    '  inputSchema: Schema.Struct({ brain: Schema.String }),',
    '  outputSchema: Empty,',
    '  reasons: [],',
    answering,
  ]),
  'command-created.ts': defined('defineCommand', 'brain', [
    post,
    '  successStatus: 201,',
    ...emptyInputAndOutput,
    answering,
  ]),
  'declared-rejection.ts': defined('defineCommand', 'brain', [
    post,
    '  inputSchema: Empty,',
    '  outputSchema: Empty,',
    "  reasons: ['conflict'],",
    conflicting,
  ]),
  'command-calls-query.ts': [
    ...callingOther('defineQuery', get, 'BrainReader'),
    ...callerOfOther('defineCommand', post),
  ],
};

interface Rejection {
  readonly because: string;
  readonly source: readonly string[];
}

const rejected: Readonly<Record<string, Rejection>> = {
  'org-query-asks-brain-context.ts': {
    because: "Type 'BrainContext' is not assignable to type 'Caller | OrgContext | OrgReader'",
    source: defined('defineQuery', 'org', [get, ...emptyInputAndOutput, asking('BrainContext')]),
  },
  'org-command-asks-brain-writer.ts': {
    because: "Type 'BrainWriter' is not assignable to type 'Caller | OrgContext | OrgReader | OrgWriter'",
    source: defined('defineCommand', 'org', [post, ...emptyInputAndOutput, asking('BrainWriter')]),
  },
  'brain-query-asks-org-reader.ts': {
    because: "Type 'OrgReader' is not assignable to type 'BrainContext | BrainReader | Caller'",
    source: defined('defineQuery', 'brain', [get, ...emptyInputAndOutput, asking('OrgReader')]),
  },
  'org-query-asks-org-writer.ts': {
    because: "Type 'OrgWriter' is not assignable to type 'Caller | OrgContext | OrgReader'",
    source: defined('defineQuery', 'org', [get, ...emptyInputAndOutput, asking('OrgWriter')]),
  },
  'brain-query-asks-brain-writer.ts': {
    because: "Type 'BrainWriter' is not assignable to type 'BrainContext | BrainReader | Caller'",
    source: defined('defineQuery', 'brain', [get, ...emptyInputAndOutput, asking('BrainWriter')]),
  },
  'query-calls-command.ts': {
    because: "Type 'BrainWriter' is not assignable to type 'BrainContext | BrainReader | Caller'",
    source: [...callingOther('defineCommand', post, 'BrainWriter'), ...callerOfOther('defineQuery', get)],
  },
  'command-asks-ledger.ts': {
    because: "Type 'Ledger' is not assignable to type 'BrainContext | BrainReader | BrainWriter | Caller'",
    source: defined('defineCommand', 'brain', [post, ...emptyInputAndOutput, asking('Ledger')]),
  },
  'command-asks-brain-registry.ts': {
    because: "Type 'BrainRegistry' is not assignable to type 'Caller | OrgContext | OrgReader | OrgWriter'",
    source: defined('defineCommand', 'org', [post, ...emptyInputAndOutput, asking('BrainRegistry')]),
  },
  'query-asks-incident-reporter.ts': {
    because: "Type 'IncidentReporter' is not assignable to type 'BrainContext | BrainReader | Caller'",
    source: defined('defineQuery', 'brain', [get, ...emptyInputAndOutput, asking('IncidentReporter')]),
  },
  'undeclared-rejection.ts': {
    because: "Type 'Conflict' is not assignable to type 'NotFound'",
    source: defined('defineCommand', 'brain', [
      post,
      '  inputSchema: Empty,',
      '  outputSchema: Empty,',
      "  reasons: ['not_found'],",
      conflicting,
    ]),
  },
  'org-input-names-org.ts': {
    because: "Types of property 'org' are incompatible",
    source: defined('defineQuery', 'org', [
      get,
      '  inputSchema: Schema.Struct({ org: Schema.String }),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'brain-input-names-brain.ts': {
    because: "Types of property 'brain' are incompatible",
    source: defined('defineQuery', 'brain', [
      get,
      '  inputSchema: Schema.Struct({ brain: Schema.String }),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'path-parameter-missing-from-input.ts': {
    because: "Property 'name' is missing",
    source: defined('defineQuery', 'brain', [
      "  route: { method: 'GET', path: '/probe/{name}' },",
      ...emptyInputAndOutput,
      answering,
    ]),
  },
  'path-parameter-not-a-string.ts': {
    because: "Types of property 'size' are incompatible",
    source: defined('defineQuery', 'brain', [
      "  route: { method: 'GET', path: '/probe/{size}' },",
      '  inputSchema: Schema.Struct({ size: Schema.Number }),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'record-keys-name-org-and-brain.ts': {
    because: "Types of property 'org' are incompatible",
    source: defined('defineQuery', 'brain', [
      get,
      "  inputSchema: Schema.Record(Schema.Literals(['brain', 'org']), Schema.String),",
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'path-parameter-missing-from-a-member.ts': {
    because: "Property 'name' is missing",
    source: defined('defineQuery', 'brain', [
      "  route: { method: 'GET', path: '/probe/{name}' },",
      '  inputSchema: Schema.Union([Schema.Struct({ name: Schema.String }), Schema.Struct({ other: Schema.String })]),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'path-parameter-optional.ts': {
    because: "Property 'name' is optional",
    source: defined('defineQuery', 'brain', [
      "  route: { method: 'GET', path: '/probe/{name}' },",
      '  inputSchema: Schema.Struct({ name: Schema.optionalKey(Schema.String) }),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'path-not-relative-to-scope.ts': {
    because: "Type '\"probe\"' is not assignable to type '`/${string}`'",
    source: defined('defineQuery', 'brain', [
      "  route: { method: 'GET', path: 'probe' },",
      ...emptyInputAndOutput,
      answering,
    ]),
  },
  'query-posts.ts': {
    because: 'Type \'"POST"\' is not assignable to type \'"GET"\'',
    source: defined('defineQuery', 'brain', [post, ...emptyInputAndOutput, answering]),
  },
  'command-gets.ts': {
    because: 'Type \'"GET"\' is not assignable to type \'"POST" | "PUT"\'',
    source: defined('defineCommand', 'brain', [get, ...emptyInputAndOutput, answering]),
  },
  'query-created.ts': {
    because: "Type '201' is not assignable to type '200'",
    source: defined('defineQuery', 'brain', [get, '  successStatus: 201,', ...emptyInputAndOutput, answering]),
  },
  'input-not-an-object.ts': {
    because: "Type 'string' is not assignable to type 'ObjectValue'",
    source: defined('defineQuery', 'brain', [
      get,
      '  inputSchema: Schema.String,',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'output-not-an-object.ts': {
    because: "Type 'number' is not assignable to type 'ObjectValue'",
    source: defined('defineQuery', 'brain', [
      get,
      '  inputSchema: Empty,',
      '  outputSchema: Schema.Number,',
      '  reasons: [],',
      '  handle: () => Effect.succeed(1),',
    ]),
  },
};

const fixtureDirectory = fileURLToPath(new URL('../../node_modules/.cache/handler-rules/', import.meta.url));

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
  }, 120_000);

  it('accepts every definition that keeps the rules and rejects every one that breaks them', () => {
    expect(new Set(errors.map((error) => error.slice(0, error.indexOf('('))))).toEqual(new Set(Object.keys(rejected)));
  });

  it.each(Object.entries(rejected))('rejects %s for the rule it breaks', (file, { because }) => {
    expect(errors.filter((error) => error.startsWith(`${file}(`)).join('\n')).toContain(because);
  });
});
