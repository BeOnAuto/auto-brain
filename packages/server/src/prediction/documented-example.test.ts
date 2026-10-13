import { uploadedWeeklyOrders } from '@on.auto/prediction/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';
import { runIdIn, settledRun } from '../testing/servers/workflow-server.ts';
import { askedBuild, candidateFile, digestOf, sentCandidate, standingWhen } from './build-calls.ts';
import { sha256Of, uploaded } from './dataset-uploads.ts';

const testTimeoutMs = 90_000;

const [, , , nextWeekOrders] = blocksInOrderOf('reference/prediction-format.md').map(({ body }) => body);

const weeks = Array.from({ length: 20 }, (_, at) => `2026-W${String(21 + at).padStart(2, '0')}`);

const orderRows = `${[
  'series,period,orders,basket,promotion',
  ...['north', 'south'].flatMap((region) =>
    weeks.map((week, at) => `${region},${week},1,10,${at % 2 === 0 ? '1' : ''}`),
  ),
].join('\r\n')}\r\n`;

function withoutPersistence(source: string): string {
  return source.replace('  holdout: 12', '  holdout: 12\n  baselines: [seasonal-naive]');
}

const asked = { input: { region: 'north', promotion: 1 } };

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function forecastRun(): Promise<unknown> {
  const started = await server.call('POST', `${alpha}/definitions/workflow/next-week-orders/run`, { body: asked });
  return (await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).body;
}

describe('the workflow of the prediction function format, through the server', { timeout: testTimeoutMs }, () => {
  it('answers no forecast before weekly-orders has an active version, and the forecast of its version after a build', async () => {
    server = await servingReasoning([], { LOCAL_MODE: 'true', WORKFLOW_SWEEP_INTERVAL: 'PT0.05S' });
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const upload = await uploaded(server.origin, orderRows);
    const created = [
      await server.call('POST', `${alpha}/definitions/prediction`, {
        body: { name: 'weekly-orders', source: withoutPersistence(uploadedWeeklyOrders(sha256Of(orderRows))) },
      }),
      await server.call('POST', `${alpha}/definitions/workflow`, {
        body: { name: 'next-week-orders', source: nextWeekOrders },
      }),
    ];
    const before = await forecastRun();
    const build = await askedBuild(server, 'weekly-orders');
    const candidate = candidateFile('orders-last');
    const sent = await sentCandidate(server, build, candidate);
    const answered = await server.call('POST', `${alpha}/runs/${build}/answer`, {
      body: { answer: { candidates: [digestOf(candidate)] } },
    });
    await standingWhen(server, 'weekly-orders', { models: { active: { version: 1 } }, build: null });
    const after = await forecastRun();

    expect([upload.status, ...created.map(({ status }) => status), sent.status, answered.status]).toEqual([
      200, 201, 201, 200, 200,
    ]);
    expect(before).toMatchObject({ status: 'succeeded', output: { forecast: null } });
    expect(after).toMatchObject({
      status: 'succeeded',
      output: { forecast: { series: 'north', horizon: 1, value: 1, low: -1, high: 3, coverage: 0.8, version: 1 } },
    });
  });
});
