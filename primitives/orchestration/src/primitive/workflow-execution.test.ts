import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { orchestratedBrain, type OrchestratedBrain } from '../testing/orchestrated-brain.ts';

let brain: OrchestratedBrain;

const flow = `document:
  dsl: '1.0.3'
  namespace: acme
  name: slow-greeting
  version: '1.0.0'
do:
  - pause: { wait: { milliseconds: 200 } }
  - greet:
      call: execute_spec
      with: { primitive: echo, name: greet, input: { name: '\${ .name }' } }
`;

const failing = `document:
  dsl: '1.0.3'
  namespace: acme
  name: failing
  version: '1.0.0'
do:
  - stop:
      raise:
        error: { type: https://example.com/busy, status: 503, title: Busy }
`;

beforeAll(async () => {
  brain = await orchestratedBrain();
  await brain.call(brain.createSpec, { primitive: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
  await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'slow-greeting', source: flow });
  await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'failing', source: failing });
});

afterAll(async () => {
  await brain.close();
});

const executionId = '0199a3c4-7d2e-7c1a-9b3f-3333333333a1';

function executing(name = 'slow-greeting', id = executionId) {
  return brain.call(brain.executeSpec, {
    primitive: 'orchestration',
    name,
    input: { name: 'Grace' },
    execution_id: id,
  });
}

describe('executing a workflow spec', () => {
  it('starts its run and answers started, recording that it finishes later', async () => {
    expect(await executing()).toMatchObject({
      status: 'succeeded',
      output: { execution_id: executionId, status: 'started' },
    });
    expect(await brain.call(brain.getExecution, { execution_id: executionId })).toMatchObject({
      output: { status: 'started', record: {} },
    });
  });

  it('answers the execution as it stands when the call is retried while the run goes on', async () => {
    expect(await executing()).toMatchObject({ output: { status: 'started' } });
  });

  it('is settled with the output when the run ends, which a retry then answers', async () => {
    const settled = {
      status: 'succeeded',
      output: { status: 'succeeded', output: { greeting: 'Hello', input: { name: 'Grace' } } },
    };

    expect(await brain.settled(executionId)).toMatchObject(settled);
    expect(await executing()).toMatchObject(settled);
  });
});

describe('executing again a workflow whose run ended without a final result', () => {
  it('is rejected as a conflict, since a workflow runs once for a run ID, and the rejection is recorded', async () => {
    const failed = '0199a3c4-7d2e-7c1a-9b3f-3333333333a2';
    await executing('failing', failed);
    const ended = await brain.settled(failed);

    expect(ended).toMatchObject({ output: { status: 'rejected', rejection: { reason: 'unavailable' } } });
    expect(await executing('failing', failed)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'This run ID already ran its workflow, which ended; a workflow runs once for a run ID, so use a new run ID to run it again',
    });
  });
});

describe('executing a workflow spec while the server stops', () => {
  it('is rejected as unavailable, and the rejection is recorded', async () => {
    const stopping = await orchestratedBrain();
    await stopping.call(stopping.createSpec, { primitive: 'orchestration', name: 'failing', source: failing });
    await stopping.close();
    const id = '0199a3c4-7d2e-7c1a-9b3f-3333333333a3';

    const outcome = await stopping.call(stopping.executeSpec, {
      primitive: 'orchestration',
      name: 'failing',
      execution_id: id,
    });

    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The workflow cannot start now; try again shortly',
    });
    expect(await stopping.call(stopping.getExecution, { execution_id: id })).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unavailable' } },
    });
  });
});
