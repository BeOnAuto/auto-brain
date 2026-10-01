import { Effect, Exit, Scope } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { brainWith } from '../testing/brain.ts';
import { orchestratedBrain, type OrchestratedBrain } from '../testing/orchestrated-brain.ts';
import { settingsFor } from '../testing/temporal.ts';
import { connectOrchestration } from './orchestration-client.ts';
import { makeOrchestration } from './orchestration-primitive.ts';

let brain: OrchestratedBrain;

const flow = `document:
  dsl: '1.0.3'
  namespace: acme
  name: slow-greeting
  version: '1.0.0'
do:
  - pause: { wait: { milliseconds: 800 } }
  - greet:
      call: execute_spec
      with: { primitive: echo, name: greet, input: { name: '\${ .name }' } }
`;

beforeAll(async () => {
  brain = await orchestratedBrain('workflow-execution');
  await brain.call(brain.createSpec, { primitive: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
  await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'slow-greeting', source: flow });
}, 60_000);

afterAll(async () => {
  await brain.close();
}, 60_000);

const executionId = '0199a3c4-7d2e-7c1a-9b3f-3333333333a1';

function executing() {
  return brain.call(brain.executeSpec, {
    primitive: 'orchestration',
    name: 'slow-greeting',
    input: { name: 'Grace' },
    execution_id: executionId,
  });
}

describe('executing a workflow spec', () => {
  it('starts its workflow and answers started, with the run it started recorded', async () => {
    expect(await executing()).toMatchObject({
      status: 'succeeded',
      output: { execution_id: executionId, status: 'started', started_by: 'acme-admin' },
    });
  });

  it('answers the execution as it stands when the call is retried while the workflow runs', async () => {
    expect(await executing()).toMatchObject({ output: { status: 'started' } });
  });

  it('is settled with the output when the workflow ends, which a retry then answers', async () => {
    const handle = brain.temporal.workflow.getHandle(`acme/alpha/slow-greeting/${executionId}`);
    await handle.result();
    const settled = {
      status: 'succeeded',
      output: { status: 'succeeded', output: { greeting: 'Hello', input: { name: 'Grace' } } },
    };

    expect(await brain.call(brain.getExecution, { execution_id: executionId })).toMatchObject(settled);
    expect(await executing()).toMatchObject(settled);
  }, 60_000);
});

describe('executing a workflow spec when Temporal cannot be reached', () => {
  it('is rejected as unavailable, and the rejection is recorded', async () => {
    const scope = Effect.runSync(Scope.make());
    const client = await Effect.runPromise(
      connectOrchestration({ ...settingsFor('nowhere'), address: '127.0.0.1:1' }, { requestTimeout: 500 }).pipe(
        Scope.provide(scope),
      ),
    );
    const isolated = brainWith([makeOrchestration({ client })]);
    await isolated.call(isolated.createSpec, { primitive: 'orchestration', name: 'slow-greeting', source: flow });

    const outcome = await isolated.call(isolated.executeSpec, {
      primitive: 'orchestration',
      name: 'slow-greeting',
      execution_id: executionId,
    });

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect(await isolated.call(isolated.getExecution, { execution_id: executionId })).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unavailable' } },
    });
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }, 30_000);
});
