import { once } from 'node:events';
import { createServer } from 'node:net';

import { Effect, Exit, Scope } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { settingsFor, temporalHarness, type TemporalHarness } from '../testing/temporal.ts';
import { runFor, workflow } from '../testing/workflows.ts';
import { connectOrchestration } from './orchestration-client.ts';

let harness: TemporalHarness;

beforeAll(async () => {
  harness = await temporalHarness('workflow-start');
}, 60_000);

afterAll(async () => {
  await harness.close();
}, 60_000);

describe('a workflow the client starts', () => {
  it('carries its org, brain, spec, version and execution in its memo, and times out after the most it may run', async () => {
    const executionId = '0199a3c4-7d2e-7c1a-9b3f-444444444441';
    const started = await Effect.runPromise(harness.orchestration.start(runFor(workflow('do: []'), executionId)));
    const description = await harness.temporal.workflow.getHandle(started.workflowId).describe();

    expect(description.memo).toStrictEqual({
      org: 'acme',
      brain: 'alpha',
      spec: 'test-flow',
      spec_version: 1,
      execution_id: executionId,
    });
    expect(Number(description.raw.executionConfig?.workflowExecutionTimeout?.seconds)).toBe(2_592_000);
  }, 60_000);
});

async function silentServer(): Promise<{ readonly address: string; readonly close: () => void }> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    address: typeof address === 'object' && address !== null ? `127.0.0.1:${String(address.port)}` : String(address),
    close: () => {
      server.close();
    },
  };
}

describe('a client whose Temporal never answers', () => {
  it('gives up on a request after 10 seconds unless told otherwise', async () => {
    const silent = await silentServer();
    const scope = Effect.runSync(Scope.make());
    const client = await Effect.runPromise(
      connectOrchestration({ ...settingsFor('silent'), address: silent.address }).pipe(Scope.provide(scope)),
    );
    const before = Date.now();
    const failure = await Effect.runPromise(Effect.flip(client.start(runFor(workflow('do: []'), 'silent'))));
    const waited = Date.now() - before;
    await Effect.runPromise(Scope.close(scope, Exit.void));
    silent.close();

    expect(failure.detail).toMatch(/^Temporal could not start the workflow: /u);
    expect(waited).toBeGreaterThanOrEqual(9_900);
    expect(waited).toBeLessThan(20_000);
  }, 60_000);
});
