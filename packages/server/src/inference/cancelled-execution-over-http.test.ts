import { setTimeout } from 'node:timers/promises';

import { Effect, Option, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingInference, type InferenceServer } from '../testing/inference-server.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const statusOf = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }));

let server: InferenceServer;

afterEach(async () => {
  await server.stop();
});

async function statusAfter(path: string, attempts: number): Promise<string | undefined> {
  const { body } = await server.call('GET', path);
  const status = Option.getOrUndefined(statusOf(body))?.status;
  if (status !== 'started' || attempts <= 1) {
    return status;
  }
  await setTimeout(50);
  return statusAfter(path, attempts - 1);
}

async function untilTheModelIsCalled(attempts: number): Promise<void> {
  if (server.modelCalls() === 0 && attempts > 1) {
    await setTimeout(50);
    await untilTheModelIsCalled(attempts - 1);
  }
}

describe('an execution whose client goes away while the model answers', () => {
  it('is recorded failed, never left started with nothing running', async () => {
    server = await servingInference([() => Effect.never]);
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });

    const givingUp = new AbortController();
    const gaveUp: Promise<unknown> = fetch(`${server.origin}${alpha}/specs/inference/summary/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text: 'the quarter' }, execution_id: executionId }),
      signal: givingUp.signal,
    }).catch((error: unknown) => error);
    await untilTheModelIsCalled(100);
    givingUp.abort();

    expect(await gaveUp).toMatchObject({ name: 'AbortError' });
    expect(server.modelCalls()).toBe(1);
    expect(await statusAfter(`${alpha}/executions/${executionId}`, 100)).toBe('failed');
  });
});
