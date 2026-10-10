import { createApiKey } from '@beonauto/identity';
import { allPermissions } from '@beonauto/operations';
import { answers, jsonResult } from '@beonauto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  runIdIn,
  servingWorkflows,
  settledRun,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/servers/workflow-server.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' });

const runner = createApiKey({
  id: 'acme-runner',
  org: 'acme',
  permissions: ['brain:read', 'brain:write'],
  brains: ['alpha'],
});

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['brain:read'], brains: ['alpha'] });

const outsider = createApiKey({ id: 'acme-outsider', org: 'acme', permissions: allPermissions, brains: ['beta'] });

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const approval = workflowSource(
  'approval',
  `do:
  - judge:
      call: run_definition
      with: { type: reasoning, name: verdict, input: { expense: '\${ $data.expense }' } }
  - decide:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
`,
);

const decided = { type: 'com.acme.approval.decided', data: { approved: true } };

const sentEventOf = Schema.decodeUnknownSync(Schema.Struct({ event: Schema.Record(Schema.String, Schema.Unknown) }));

let server: ReasoningServer;

beforeEach(async () => {
  server = await servingWorkflows([answers(jsonResult({ approve: true }))], {
    API_KEYS: JSON.stringify([admin.entry, runner.entry, reader.entry, outsider.entry]),
  });
  const asAdmin = { key: admin.key };
  await server.call('POST', '/v1/orgs/acme/brains', { ...asAdmin, body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    ...asAdmin,
    body: { name: 'verdict', source: verdict },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    ...asAdmin,
    body: { name: 'approval', source: approval },
  });
});

afterEach(async () => {
  await server.stop();
});

async function startedBy(key: string): Promise<string> {
  const response = await server.call('POST', `${alpha}/definitions/workflow/approval/run`, {
    key,
    body: { input: { expense: 'a taxi' } },
  });
  expect(response).toMatchObject({ status: 200, body: { status: 'started' } });
  return runIdIn(response.body);
}

describe('a workflow that listens for an event, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('takes the event sent to its run and settles with it, as the caller who started it', async () => {
    const runId = await startedBy(runner.key);

    const sent = await server.call('POST', `${alpha}/runs/${runId}/events`, {
      key: runner.key,
      body: { event: decided },
    });
    const settled = await settledRun(server, `${alpha}/runs/${runId}`, { key: runner.key });
    const nested = server.modelRunIds()[0];

    expect(sent).toMatchObject({ status: 200, body: { run_id: runId, event: decided } });
    expect(Object.keys(sentEventOf(sent.body).event)).toEqual(['type', 'source', 'data', 'id', 'time']);
    expect(settled).toMatchObject({
      body: { status: 'succeeded', output: [{ approved: true }], started_by: 'acme-runner' },
    });
    expect(await server.call('GET', `${alpha}/runs/${String(nested)}`, { key: admin.key })).toMatchObject({
      body: { type: 'reasoning', name: 'verdict', status: 'succeeded', started_by: 'acme-runner' },
    });
  });
});

describe('a key without access to the brain of a workflow', { timeout: workflowTestTimeoutMs }, () => {
  it('cannot execute it, read its run, or send it an event', async () => {
    const runId = await startedBy(admin.key);
    const asOutsider = { key: outsider.key };

    const running = await server.call('POST', `${alpha}/definitions/workflow/approval/run`, {
      ...asOutsider,
      body: { input: { expense: 'a yacht' } },
    });
    const reading = await server.call('GET', `${alpha}/runs/${runId}`, asOutsider);
    const sending = await server.call('POST', `${alpha}/runs/${runId}/events`, {
      ...asOutsider,
      body: { event: decided },
    });
    await server.call('POST', `${alpha}/runs/${runId}/events`, {
      key: admin.key,
      body: { event: decided },
    });

    expect([running.status, reading.status, sending.status]).toEqual([403, 403, 403]);
    expect(await settledRun(server, `${alpha}/runs/${runId}`, { key: admin.key })).toMatchObject({
      body: { status: 'succeeded', output: [{ approved: true }] },
    });
  });

  it('that may only read cannot execute it or send it an event, but can read its run', async () => {
    const runId = await startedBy(admin.key);
    const asReader = { key: reader.key };

    const running = await server.call('POST', `${alpha}/definitions/workflow/approval/run`, {
      ...asReader,
      body: { input: { expense: 'a yacht' } },
    });
    const sending = await server.call('POST', `${alpha}/runs/${runId}/events`, {
      ...asReader,
      body: { event: decided },
    });
    const reading = await server.call('GET', `${alpha}/runs/${runId}`, asReader);
    await server.call('POST', `${alpha}/runs/${runId}/events`, {
      key: admin.key,
      body: { event: decided },
    });

    expect([running.status, sending.status, reading.status]).toEqual([403, 403, 200]);
  });
});
