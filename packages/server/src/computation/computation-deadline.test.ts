import { computationBounds } from '@beonauto/computation';
import { campaignPace, campaignRows } from '@beonauto/computation/testing';
import { programPool } from '@beonauto/workflow-engine/dsl';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const blockingOnTwoRows = new URL(
  `data:text/javascript,${encodeURIComponent(
    [
      "import { parentPort, threadId } from 'node:worker_threads';",
      'let jobs = 0;',
      "parentPort.on('message', ({ job, request }) => {",
      '  jobs += 1;',
      '  if (JSON.parse(request.input).rows.length === 2) { while (true) {} }',
      '  const output = JSON.stringify({ jobs, thread: threadId });',
      "  parentPort.postMessage({ job, answer: { ran: 'answered', output, bytes: output.length, work: 0 }, keep: true });",
      '});',
    ].join('\n'),
  )}`,
);

const decodeRan = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ jobs: Schema.Number, thread: Schema.Number }) }),
);

const timerSlackMs = 2;

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function executed(rows: number) {
  return server.call('POST', `${alpha}/specs/computation/pace/execute`, { body: { input: campaignRows(rows) } });
}

async function ranOn(rows: number) {
  return decodeRan((await executed(rows)).body).output;
}

describe('a run of a computation function that does not end by itself, over HTTP', { timeout: 60_000 }, () => {
  it('is unavailable once its warm worker is terminated at the deadline, while another worker answers and the server answers other requests', async () => {
    server = await servingReasoning([], { LOCAL_MODE: 'true' }, undefined, ({ workers }) =>
      programPool({ workers, heapMegabytes: computationBounds.heapMegabytes, worker: blockingOnTwoRows }),
    );
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/specs/computation`, { body: { name: 'pace', source: campaignPace } });
    const warm = await ranOn(3);
    const started = performance.now();
    const settled = { run: false };

    const running = executed(2).then((response) => {
      settled.run = true;
      return { response, milliseconds: performance.now() - started };
    });
    const meanwhile = await server.call('GET', `${alpha}/specs/computation/pace`);
    const elsewhere = await ranOn(3);
    const answeredFirst = !settled.run;
    const { response, milliseconds } = await running;
    const after = await ranOn(3);

    expect(meanwhile).toMatchObject({ status: 200, body: { name: 'pace' } });
    expect([answeredFirst, elsewhere.jobs]).toEqual([true, 1]);
    expect(elsewhere.thread).not.toBe(warm.thread);
    expect(response).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail: 'The run took longer than the 10000 ms a computation function may run, and was stopped',
      },
    });
    expect(milliseconds).toBeGreaterThanOrEqual(computationBounds.deadlineMs - timerSlackMs);
    expect(after).toEqual({ jobs: 2, thread: elsewhere.thread });
  });
});
