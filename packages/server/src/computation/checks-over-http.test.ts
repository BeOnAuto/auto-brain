import { campaignPace, campaignRows } from '@beonauto/computation/testing';
import type { CheckOutcome, ProgramPool } from '@beonauto/workflow-engine/dsl';
import { afterEach, describe, expect, it } from 'vitest';

import { workerPool, type ProgramPoolOf } from '../composition/served-computation.ts';
import { checkRefusals, documentOf, totalOf } from '../testing/servers/check-refusals.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const checkTestTimeoutMs = 30_000;

const paceOfTwoRows = {
  campaigns: [
    { campaign: 'campaign-0', spend_cents: 1000, projected_cents: 2583, pace_permille: 0 },
    { campaign: 'campaign-1', spend_cents: 1037, projected_cents: 2678, pace_permille: 0 },
  ],
  total_spend_cents: 2037,
};

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

async function serving(programPoolOf: ProgramPoolOf = workerPool): Promise<ReasoningServer> {
  server = await servingReasoning([], { LOCAL_MODE: 'true' }, undefined, { programPoolOf });
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  return server;
}

function saving(name: string, source: string) {
  return server.call('POST', `${alpha}/definitions/computation`, { body: { name, source } });
}

describe('a computation function checked when it is saved, over HTTP', { timeout: checkTestTimeoutMs }, () => {
  it.each(checkRefusals)(
    'is refused for %s, at its line, in the compiler’s words or the runtime’s',
    async (_, program, details) => {
      await serving();

      expect(await saving('refused', documentOf(program))).toMatchObject({
        status: 422,
        body: { reason: 'invalid_input', errors: details.map((detail) => ({ pointer: '/source', detail })) },
      });
    },
  );
});

describe(
  'the language of a computation function, checked when it is saved, over HTTP',
  { timeout: checkTestTimeoutMs },
  () => {
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
      expect(await saving('pace', campaignPace)).toMatchObject({
        status: 201,
        body: { type: 'computation', name: 'pace', version: 1, source: campaignPace },
      });
    });
  },
);

describe('a long document checked when it is saved, over HTTP', { timeout: checkTestTimeoutMs }, () => {
  it('checks and saves a document of 64 KiB, the most a document may be', async () => {
    await serving();
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
    expect(await saving('long', source)).toMatchObject({
      status: 201,
      body: { type: 'computation', name: 'long', version: 1, source },
    });
  });
});

describe('the check at save, over HTTP', { timeout: checkTestTimeoutMs }, () => {
  it('runs once when the server starts, to warm its worker, and then once a save, never when a definition is read or run', async () => {
    const { checks, poolOf } = countingChecks();
    await serving(poolOf);
    const atStart = checks.count();

    await saving('pace', campaignPace);
    await server.call('GET', `${alpha}/definitions/computation/pace`);
    const ran = await server.call('POST', `${alpha}/definitions/computation/pace/run`, {
      body: { input: campaignRows(2) },
    });

    expect(ran).toMatchObject({ status: 200, body: { status: 'succeeded', output: paceOfTwoRows } });
    expect([atStart, checks.count()]).toEqual([1, 2]);
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
