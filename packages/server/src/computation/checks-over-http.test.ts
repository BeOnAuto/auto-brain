import { campaignPace, campaignRows } from '@beonauto/computation/testing';
import type { CheckOutcome, ProgramPool } from '@beonauto/workflow-engine/dsl';
import { afterEach, describe, expect, it } from 'vitest';

import { workerPool, type ProgramPoolOf } from '../composition/served-computation.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const checkTestTimeoutMs = 30_000;

const input = 'input:\n  schema: {type: object, required: [period], properties: {period: {type: integer}}}';

const output = 'output:\n  schema: {type: object, required: [total], properties: {total: {type: number}}}';

function documentOf(program: readonly string[], language = 'typescript'): string {
  return ['---', `language: ${language}`, input, output, '---', ...program].join('\n');
}

function totalOf(...body: readonly string[]): readonly string[] {
  return ['export default function (input: Input): Output {', ...body, '}'];
}

const readsNothing = 'A program reads nothing but its arguments: it imports no module and builds no code';

const holdsNothing =
  'A module holds its types and its exported functions and nothing else, so that two calls share nothing';

const refusals: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ['a syntax error', totalOf('  return { total: };'), ['Line 9: Expression expected.']],
  [
    'a misspelt field',
    totalOf('  return { total: input.perod };'),
    ["Line 9: Property 'perod' does not exist on type 'Input'. Did you mean 'period'?"],
  ],
  [
    'syntax that is not erasable',
    ['enum Color { Red }', ...totalOf('  return { total: 1 };')],
    ["Line 8: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.", `Line 8: ${holdsNothing}`],
  ],
  [
    'an import',
    ["import { readFileSync } from 'node:fs';", ...totalOf('  return { total: readFileSync.length };')],
    ["Line 8: Cannot find name 'node:fs'.", `Line 8: ${readsNothing}`],
  ],
  [
    'state kept between two runs',
    ['let runs = 0;', ...totalOf('  return { total: runs };')],
    [`Line 8: ${holdsNothing}`],
  ],
  [
    'no default export',
    ['export function total(input: Input): Output {', '  return { total: input.period };', '}'],
    ['Line 8: The program is a module whose default export is a function (input: Input): Output'],
  ],
  [
    'a program that awaits',
    ['export default async function (input: Input): Promise<Output> {', '  return { total: await input.period };', '}'],
    [
      'Line 8: The program is a function that answers at once; it awaits nothing',
      "Line 8: The program is a module whose default export is a function (input: Input): Output: Type '(input: Input) => Promise<Output>' is not assignable to type '(input: Input) => Output'. Property 'total' is missing in type 'Promise<Output>' but required in type 'Output'.",
      'Line 9: The program is a function that answers at once; it awaits nothing',
    ],
  ],
  [
    'a name the sandbox lacks',
    totalOf('  return { total: Math.random() };'),
    ["Line 9: Property 'random' does not exist on type 'Math'."],
  ],
];

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

const deadlineStopped: CheckOutcome = { ran: 'stopped', because: 'deadline', milliseconds: 2000 };

interface Checks {
  readonly count: () => number;
  readonly stall: () => void;
}

function countingChecks(): { readonly checks: Checks; readonly poolOf: ProgramPoolOf } {
  let count = 0;
  let stalled = false;
  const checking = (pool: ProgramPool): ProgramPool => ({
    ...pool,
    check: (request, signal) => {
      count += 1;
      return stalled ? Promise.resolve(deadlineStopped) : pool.check(request, signal);
    },
  });
  return {
    checks: {
      count: () => count,
      stall: () => {
        stalled = true;
      },
    },
    poolOf: (settings) => checking(workerPool(settings)),
  };
}

function timedChecks(): { readonly checks: { readonly lastMs: () => number }; readonly poolOf: ProgramPoolOf } {
  let lastMs = Number.POSITIVE_INFINITY;
  const timing = (pool: ProgramPool): ProgramPool => ({
    ...pool,
    check: async (request, signal) => {
      const outcome = await pool.check(request, signal);
      lastMs = outcome.milliseconds;
      return outcome;
    },
  });
  return { checks: { lastMs: () => lastMs }, poolOf: (settings) => timing(workerPool(settings)) };
}

async function serving(programPoolOf: ProgramPoolOf = workerPool): Promise<ReasoningServer> {
  server = await servingReasoning([], { LOCAL_MODE: 'true' }, undefined, { programPoolOf });
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  return server;
}

function saving(name: string, source: string) {
  return server.call('POST', `${alpha}/definitions/computation`, { body: { name, source } });
}

describe('a computation function checked when it is saved, over HTTP', { timeout: checkTestTimeoutMs }, () => {
  it.each(refusals)(
    'is refused for %s, at its line, in the compiler’s words or the runtime’s',
    async (_, program, details) => {
      await serving();

      expect(await saving('refused', documentOf(program))).toMatchObject({
        status: 422,
        body: { reason: 'invalid_input', errors: details.map((detail) => ({ pointer: '/source', detail })) },
      });
    },
  );

  it('is refused for a language other than TypeScript, and saved when correct', async () => {
    await serving();

    expect(await saving('python', documentOf(totalOf('  return { total: 1 };'), 'python'))).toMatchObject({
      status: 422,
      body: {
        errors: [
          {
            pointer: '/source',
            detail:
              "Line 2, /language: The brain's one language is TypeScript; write the program as a TypeScript function",
          },
        ],
      },
    });
    expect(await saving('pace', campaignPace)).toMatchObject({ status: 201 });
  });
});

describe('a long document checked when it is saved, over HTTP', { timeout: checkTestTimeoutMs }, () => {
  it('checks a document of 64 KiB, in a warm worker, well within the 2 seconds of its check', async () => {
    const { checks, poolOf } = timedChecks();
    await serving(poolOf);
    await saving('pace', campaignPace);
    const rates = Array.from({ length: 3650 }, (_, index) => `    rate${index}: ${index % 97},`);
    const source = documentOf([
      'export default function (input: Input): Output {',
      '  const rates: Record<string, number> = {',
      ...rates,
      '  };',
      "  return { total: input.period * (rates['rate1'] ?? 0) };",
      '}',
    ]);

    expect(source.length).toBeGreaterThan(64_000);
    expect(source.length).toBeLessThanOrEqual(65_536);
    expect(await saving('long', source)).toMatchObject({ status: 201 });
    expect(checks.lastMs()).toBeLessThan(2000);
  });
});

describe('the check at save, over HTTP', { timeout: checkTestTimeoutMs }, () => {
  it('runs once a save, never when a definition is read or run', async () => {
    const { checks, poolOf } = countingChecks();
    await serving(poolOf);

    await saving('pace', campaignPace);
    await server.call('GET', `${alpha}/definitions/computation/pace`);
    const ran = await server.call('POST', `${alpha}/definitions/computation/pace/run`, {
      body: { input: campaignRows(2) },
    });

    expect(ran).toMatchObject({ status: 200 });
    expect(checks.count()).toBe(1);
  });

  it('leaves the document unsaved and answers unavailable, on a create and an update, when it does not answer in time', async () => {
    const { checks, poolOf } = countingChecks();
    await serving(poolOf);
    await saving('pace', campaignPace);
    checks.stall();
    const unavailable = {
      status: 503,
      body: {
        reason: 'unavailable',
        detail:
          'The check of the document did not answer within the 2000 ms a save allows it, and was stopped; try again',
      },
    };

    expect(await saving('again', campaignPace)).toMatchObject(unavailable);
    expect(
      await server.call('PUT', `${alpha}/definitions/computation/pace`, { body: { source: `${campaignPace}\n` } }),
    ).toMatchObject(unavailable);
    expect(await server.call('GET', `${alpha}/definitions/computation/pace`)).toMatchObject({
      body: { version: 1, source: campaignPace },
    });
  });
});
