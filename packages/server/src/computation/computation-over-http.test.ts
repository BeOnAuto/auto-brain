import { campaignPace, campaignRows, scriptedPool } from '@beonauto/computation/testing';
import type { PoolOutcome } from '@beonauto/workflow-engine/dsl';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { workerPool, type ProgramPoolOf } from '../composition/served-computation.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/reasoning-server.ts';

const computationTestTimeoutMs = 30_000;

const raising = [
  '---',
  'language: jq',
  '---',
  '.rows',
  '| map(.cost_cents)',
  '| error("no budget for \\(length) rows")',
].join('\n');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Unknown })),
  }),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function scripted(...outcomes: readonly PoolOutcome[]): ProgramPoolOf {
  return (settings) => scriptedPool(outcomes, workerPool(settings));
}

async function serving(programPoolOf: ProgramPoolOf = workerPool): Promise<ReasoningServer> {
  server = await servingReasoning([], { LOCAL_MODE: 'true' }, undefined, programPoolOf);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/computation`, { body: { name: 'pace', source: campaignPace } });
  await server.call('POST', `${alpha}/specs/computation`, { body: { name: 'raising', source: raising } });
  return server;
}

function executing(name: string, body: object) {
  return server.call('POST', `${alpha}/specs/computation/${name}/execute`, { body });
}

describe('a computation function over HTTP', { timeout: computationTestTimeoutMs }, () => {
  it('runs its program on the input and answers the output, recorded with the work, the time and the sizes', async () => {
    await serving();

    const executed = await executing('pace', { input: campaignRows(100), execution_id: executionId });
    const read = await server.call('GET', `${alpha}/executions/${executionId}`);

    expect(executed).toMatchObject({
      status: 200,
      body: {
        primitive: 'computation',
        name: 'pace',
        status: 'succeeded',
        output: { campaigns: [{ campaign: 'campaign-0' }, {}, {}, {}], total_spend_cents: 283_150 },
      },
    });
    expect(read).toMatchObject({
      status: 200,
      body: { record: { language: 'jq', input_bytes: JSON.stringify(campaignRows(100)).length } },
    });
    expect(read.body).toHaveProperty('record.work');
    expect(read.body).toHaveProperty('record.duration_ms');
    expect(read.body).toHaveProperty('record.output_bytes');
  });

  it('is listed and read with the spec operations, its schemas and description shown', async () => {
    await serving();

    expect(await server.call('GET', `${alpha}/specs/computation/pace`)).toMatchObject({
      status: 200,
      body: {
        primitive: 'computation',
        media_type: 'text/markdown',
        description: 'Spend, pace and projection per campaign, in cents, for a reporting period',
        input_schema: { type: 'object', required: ['rows', 'period'] },
        output_schema: { type: 'object', required: ['campaigns', 'total_spend_cents'] },
      },
    });
  });
});

describe(
  'a run of a computation function that cannot work as written, over HTTP',
  { timeout: computationTestTimeoutMs },
  () => {
    it('ends in conflict, unworkable, with the error and its line, recorded, listed and told with its kind', async () => {
      await serving();
      const detail = 'The program raised an error on line 6: no budget for 2 rows';

      const executed = await executing('raising', { input: campaignRows(2), execution_id: executionId });
      const read = await server.call('GET', `${alpha}/executions/${executionId}`);
      const listed = await server.call('GET', `${alpha}/executions?primitive=computation`);
      const { events } = decodeHistory((await server.call('GET', `${alpha}/executions/${executionId}/history`)).body);

      expect(executed).toMatchObject({ status: 409, body: { reason: 'conflict', kind: 'unworkable', detail } });
      expect(read.body).toMatchObject({
        status: 'rejected',
        rejection: { reason: 'conflict', kind: 'unworkable', detail },
      });
      expect(listed.body).toMatchObject({
        executions: [{ execution_id: executionId, rejection: { reason: 'conflict', kind: 'unworkable' } }],
      });
      expect(events.map(({ type }) => type)).toEqual(['execution_started', 'execution_rejected']);
      expect(events[1]).toMatchObject({
        summary: 'A run did not go through: it cannot work as it is written.',
        data: { reason: 'conflict', kind: 'unworkable', detail },
      });
      expect(events.every(({ data }) => JSON.stringify(data).length <= 4096)).toBe(true);
    });

    it('runs again under its id, ending the same way, since the same input gives the same result', async () => {
      await serving();

      const first = await executing('raising', { input: campaignRows(2), execution_id: executionId });
      const again = await executing('raising', { input: campaignRows(2), execution_id: executionId });

      expect(again.body).toEqual(first.body);
    });
  },
);

describe('an output too large to record, over HTTP', { timeout: computationTestTimeoutMs }, () => {
  it('ends in conflict for an output that would take 240 MB as JSON, measured before it is written, and the server answers on', async () => {
    await serving();
    const doubled = ['---', 'language: jq', '---', '("\\u0001Ā" * 15000000) | [., .]'].join('\n');
    await server.call('POST', `${alpha}/specs/computation`, { body: { name: 'doubled', source: doubled } });

    expect(await executing('doubled', { input: null })).toMatchObject({
      status: 409,
      body: {
        reason: 'conflict',
        kind: 'unworkable',
        detail: "The program's output takes more than the 1048320 bytes as JSON a run can record",
      },
    });
    expect(await executing('pace', { input: campaignRows(2) })).toMatchObject({ status: 200 });
  });
});

describe(
  'the definitions and inputs of computation functions, over HTTP',
  { timeout: computationTestTimeoutMs },
  () => {
    it('rejects an input the input schema refuses, under /input', async () => {
      await serving();

      expect(
        await executing('pace', { input: { rows: [], period: { days_elapsed: 0, days_total: 30 } } }),
      ).toMatchObject({
        status: 422,
        body: { reason: 'invalid_input', errors: [{ pointer: '/input/period/days_elapsed' }] },
      });
    });

    it('refuses a definition with each problem and its line, under /source, and a document over 64 KiB', async () => {
      await serving();
      const refused = ['---', 'language: jq', 'model: anthropic/claude-sonnet-4-5', '---', 'now'].join('\n');

      expect(
        await server.call('POST', `${alpha}/specs/computation`, { body: { name: 'clock', source: refused } }),
      ).toMatchObject({
        status: 422,
        body: {
          reason: 'invalid_input',
          errors: [
            {
              pointer: '/source',
              detail:
                'Line 3, /model: model is not a key of the front matter; it takes description, language, input, output',
            },
            {
              pointer: '/source',
              detail:
                'Line 5: now reads the clock, so the same input would not give the same output; pass the time in the input',
            },
          ],
        },
      });
      expect(
        await server.call('POST', `${alpha}/specs/computation`, {
          body: { name: 'large', source: `---\nlanguage: jq\n---\n${'.'.repeat(65_536)}` },
        }),
      ).toMatchObject({ status: 422, body: { reason: 'invalid_input', errors: [{ pointer: '/source' }] } });
    });
  },
);

describe(
  'a run of a computation function the server cannot finish, over HTTP',
  { timeout: computationTestTimeoutMs },
  () => {
    it('is unavailable when no worker is free within its deadline', async () => {
      await serving(scripted({ ran: 'stopped', because: 'busy', milliseconds: 10_000 }));

      expect(await executing('pace', { input: campaignRows(2) })).toMatchObject({
        status: 503,
        body: {
          reason: 'unavailable',
          detail: 'No worker was free to run it within 10000 ms; this server runs 4 computation functions at once',
        },
      });
    });

    it('fails with an incident when its worker crashes, and the run is recorded as failed', async () => {
      await serving(
        scripted({ ran: 'crashed', detail: 'The worker ended with code 1 before it answered', milliseconds: 5 }),
      );

      const executed = await executing('pace', { input: campaignRows(2), execution_id: executionId });

      expect(executed).toMatchObject({ status: 500 });
      expect(await server.call('GET', `${alpha}/executions/${executionId}`)).toMatchObject({
        body: { status: 'failed' },
      });
    });
  },
);
