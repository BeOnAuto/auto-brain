import { setTimeout } from 'node:timers/promises';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/reasoning-server.ts';
import {
  executionIdIn,
  servingWorkflows,
  settledExecution,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/workflow-server.ts';

const ListedRuns = Schema.Struct({
  executions: Schema.Array(
    Schema.Struct({
      execution_id: Schema.String,
      name: Schema.String,
      status: Schema.String,
      started_by: Schema.String,
    }),
  ),
});

const runsIn = Schema.decodeUnknownSync(ListedRuns);

type ListedRun = (typeof ListedRuns.Type)['executions'][number];

const closing = workflowSource(
  'close-the-month',
  "schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - total: { set: { month: '${ .[0].data.month }' } }\n",
);

const announcing = workflowSource(
  'announce',
  'do:\n  - announce: { emit: { event: { with: { type: com.acme.ledger.closed, source: https://acme.example/ledger, data: { month: october } } } } }\n',
);

const approving = workflowSource(
  'approval',
  "do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.approved } } } }, output: { as: '${ .[0] }' } }\n",
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function created([name, source]: readonly [string, string]): Promise<void> {
  await server.call('POST', `${alpha}/specs/orchestration`, { body: { name, source } });
}

async function servingWith(...specs: readonly (readonly [string, string])[]): Promise<void> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await specs.reduce<Promise<void>>((before, spec) => before.then(() => created(spec)), Promise.resolve());
}

async function runsOf(name: string, attempts = 300): Promise<readonly ListedRun[]> {
  const response = await server.call('GET', `${alpha}/executions?primitive=orchestration&name=${name}`);
  const { executions } = runsIn(response.body);
  if (executions.some(({ status }) => status !== 'started') || attempts <= 1) {
    return executions;
  }
  await setTimeout(100);
  return runsOf(name, attempts - 1);
}

async function triggeredRunOf(name: string) {
  const [run] = await runsOf(name);
  const settled = await settledExecution(server, `${alpha}/executions/${run?.execution_id ?? ''}`);
  return { run, settled };
}

describe('a workflow whose trigger is an event', { timeout: workflowTestTimeoutMs }, () => {
  it('is run by the brain itself for an event published to the brain, with the event as its input', async () => {
    await servingWith(['close-the-month', closing]);

    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'september' } } },
    });
    const { run, settled } = await triggeredRunOf('close-the-month');

    expect(run).toMatchObject({ status: 'succeeded', started_by: 'brain:alpha' });
    expect(settled.body).toMatchObject({ status: 'succeeded', output: { month: 'september' } });
  });

  it('is run for an event another workflow emits', async () => {
    await servingWith(['close-the-month', closing], ['announce', announcing]);

    const announced = await server.call('POST', `${alpha}/specs/orchestration/announce/execute`, {
      body: { input: {} },
    });
    await settledExecution(server, `${alpha}/executions/${executionIdIn(announced.body)}`);
    const { settled } = await triggeredRunOf('close-the-month');

    expect(settled.body).toMatchObject({ status: 'succeeded', output: { month: 'october' } });
  });
});

describe('a run waiting for an event whose type its filter names', { timeout: workflowTestTimeoutMs }, () => {
  it('takes one published to its brain', async () => {
    await servingWith(['approval', approving]);
    const started = await server.call('POST', `${alpha}/specs/orchestration/approval/execute`, { body: { input: {} } });
    const path = `${alpha}/executions/${executionIdIn(started.body)}`;
    await setTimeout(200);

    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/desk', type: 'com.acme.approved', data: { by: 'Ada' } } },
    });
    const settled = await settledExecution(server, path);

    expect(settled.body).toMatchObject({ status: 'succeeded', output: { by: 'Ada' } });
  });
});
