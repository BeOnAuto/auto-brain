import { campaignPace, campaignRows } from '@beonauto/computation/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const executionIds = { cold: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', warm: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b' };

const decodeRun = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal('succeeded'),
    output: Schema.Json,
    record: Schema.Struct({ work: Schema.Number, input_bytes: Schema.Number, output_bytes: Schema.Number }),
  }),
);

async function ranIn(server: ReasoningServer, input: Schema.Json, executionId: string) {
  await server.call('POST', `${alpha}/specs/computation/pace/execute`, { body: { input, execution_id: executionId } });
  const { output, record } = decodeRun((await server.call('GET', `${alpha}/executions/${executionId}`)).body);
  return { output, work: record.work, input_bytes: record.input_bytes, output_bytes: record.output_bytes };
}

async function ranOn(server: ReasoningServer, input: Schema.Json) {
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/computation`, { body: { name: 'pace', source: campaignPace } });
  const cold = await ranIn(server, input, executionIds.cold);
  const warm = await ranIn(server, input, executionIds.warm);
  await server.stop();
  return { cold, warm };
}

describe('a computation function on two servers, each with a store of its own', { timeout: 60_000 }, () => {
  it('gives the same output for the same input, after the same work, in a cold worker and then a warm one', async () => {
    const input = campaignRows(1000);

    const first = await ranOn(await servingReasoning([]), input);
    const second = await ranOn(await servingReasoning([]), input);

    expect(second).toEqual(first);
    expect(first.warm).toEqual(first.cold);
  });
});
