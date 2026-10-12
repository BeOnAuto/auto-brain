import { weeklyOrders } from '@on.auto/prediction/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const testTimeoutMs = 60_000;

const question = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';

const build = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  const server = await servingReasoning([], { LOCAL_MODE: 'true', ...environment });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return server;
}

function saved(server: ReasoningServer, name: string, source = weeklyOrders) {
  return server.call('POST', `${alpha}/definitions/prediction`, { body: { name, source } });
}

function published(server: ReasoningServer, id: string, data: object) {
  return server.call('POST', `${alpha}/events`, {
    body: { event: { id, source: '/shop', type: 'order.placed', data } },
  });
}

function standingUntil(server: ReasoningServer, folded: number, passedOver: number): Promise<unknown> {
  return vi.waitFor(
    async () => {
      const { body } = await server.call('GET', `${alpha}/definitions/prediction/weekly-orders`);
      expect(body).toMatchObject({
        standing: { dataset: { phase: 'live', events_folded: folded, passed_over: passedOver } },
      });
      return body;
    },
    { timeout: testTimeoutMs - 10_000, interval: 50 },
  );
}

function historyOf(server: ReasoningServer, runId: string) {
  return server.call('GET', `${alpha}/runs/${runId}/history`);
}

describe('a prediction function saved over HTTP', { timeout: testTimeoutMs }, () => {
  it('is saved from its document with its input and output derived from it, and stands on the dataset it folds from the events the playbook records', async () => {
    const server = await serving();

    const created = await saved(server, 'weekly-orders');
    await published(server, 'o-1', { placed_at: '2026-10-06T10:00:00Z', region: 'north', total: 30, promotion: 1 });
    await published(server, 'o-2', { placed_at: '2026-10-07T10:00:00Z', region: 'north', total: 10 });
    await published(server, 'o-3', { placed_at: '2026-10-07T11:00:00Z', region: 7, total: 10 });
    const standing = await standingUntil(server, 2, 1);

    expect(created).toMatchObject({
      status: 201,
      body: {
        type: 'prediction',
        media_type: 'text/markdown',
        input_schema: { oneOf: [{ title: 'question' }, { title: 'build' }] },
        output_schema: { oneOf: [{ title: 'prediction' }, { title: 'build' }] },
      },
    });
    expect(standing).toMatchObject({
      standing: {
        dataset: {
          kind: 'projection',
          rows: 1,
          series: 1,
          first_period: '2026-W41',
          last_period: '2026-W41',
          passed_over: 1,
        },
      },
    });
  });
});

describe('a run of a prediction function over HTTP before a version is built', () => {
  it('refuses a question, since no version is active, and a build, which this runtime does not offer yet and no retry gets, each after its start, and only a build finishes later', async () => {
    const server = await serving();
    await saved(server, 'weekly-orders');
    const run = `${alpha}/definitions/prediction/weekly-orders/run`;

    const asked = await server.call('POST', run, {
      body: { input: { series: 'north', horizon: 1, given: { promotion: 1 } }, run_id: question },
    });
    const built = await server.call('POST', run, { body: { input: { build: {} }, run_id: build } });
    const histories = await Promise.all([historyOf(server, question), historyOf(server, build)]);

    expect([asked.status, asked.body]).toEqual([
      409,
      expect.objectContaining({ reason: 'conflict', kind: 'no_active_version' }),
    ]);
    expect([built.status, built.body, built.headers.get('retry-after')]).toEqual([
      503,
      expect.objectContaining({ reason: 'unavailable', kind: 'build_not_offered' }),
      null,
    ]);
    expect(histories.map(({ body }) => body)).toMatchObject([
      { events: [{ type: 'run_started', data: { input: { series: 'north' } } }, { type: 'run_rejected' }] },
      { events: [{ type: 'run_started', data: { finishes_later: true } }, { type: 'run_rejected' }] },
    ]);
    expect(histories[0]?.body).not.toHaveProperty('events.0.data.finishes_later');
  });
});

describe('the prediction functions a playbook keeps', () => {
  it('are refused at save past PREDICTION_MAX_FUNCTIONS active functions of a playbook', async () => {
    const server = await serving({ PREDICTION_MAX_FUNCTIONS: '1' });

    const first = await saved(server, 'weekly-orders');
    const second = await saved(server, 'more-orders');

    expect([first.status, second.status]).toEqual([201, 409]);
    expect(second.body).toMatchObject({
      detail:
        'The playbook keeps 1 active prediction functions, and a playbook may keep at most 1; retire one before creating another',
    });
  });
});
