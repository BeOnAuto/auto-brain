import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordHistory } from '../../replay-corpus.ts';
import type { JsonObject } from '../dsl/json.ts';
import { runFor, temporalHarness, type TemporalHarness } from '../testing/temporal.ts';
import { workflow } from '../testing/workflows.ts';
import type { SpecExecution, SpecExecutionResult } from './dependencies.ts';

let harness: TemporalHarness;

const flakyCalls = new Map<string, number>();

function respond({ name, input }: SpecExecution): SpecExecutionResult {
  if (name === 'flaky') {
    const calls = (flakyCalls.get(JSON.stringify(input)) ?? 0) + 1;
    flakyCalls.set(JSON.stringify(input), calls);
    return calls < 3
      ? { status: 'rejected', reason: 'unavailable', detail: `busy on call ${calls}` }
      : { status: 'succeeded', output: { calls } };
  }
  return { status: 'succeeded', output: { summary: `${name} of ${JSON.stringify(input)}` } };
}

beforeAll(async () => {
  harness = await temporalHarness('worker-end-to-end', { respond });
}, 60_000);

afterAll(async () => {
  await harness.close();
}, 60_000);

async function ran(name: string, number: number, source: string, input: JsonObject = {}) {
  const executionId = `0199a3c4-7d2e-7c1a-9b3f-${String(number).padStart(12, '0')}`;
  const started = await Effect.runPromise(harness.orchestration.start(runFor(workflow(source), executionId, input)));
  const handle = harness.temporal.workflow.getHandle(started.workflowId);
  const output: unknown = await handle.result().catch((error: unknown) => error);
  await recordHistory(name, () => handle.fetchHistory());
  return {
    started,
    output,
    executionId,
    settled: harness.settled().filter(({ address }) => address.id === executionId),
  };
}

describe('the orchestration worker', () => {
  it('runs a workflow that executes a spec and settles the execution', async () => {
    const { started, output, executionId, settled } = await ran(
      'execute-spec',
      1,
      `
do:
  - summarize:
      call: execute_spec
      with: { primitive: inference, name: summarize, input: { text: '\${ .text }' } }
  - answer:
      set: { summary: '\${ .summary }', runtime: '\${ $runtime.name }' }
`,
      { text: 'hello' },
    );

    expect(started.workflowId).toBe(`acme/alpha/test-flow/${executionId}`);
    expect(output).toEqual({ summary: 'summarize of {"text":"hello"}', runtime: 'auto-brain' });
    expect(settled).toEqual([
      {
        address: { org: 'acme', brain: 'alpha', id: executionId },
        settlement: { status: 'succeeded', output, record: {} },
      },
    ]);
  }, 60_000);

  it('retries a failing step with backoff on durable timers, each attempt its own execution', async () => {
    const before = Date.now();
    const { output } = await ran(
      'retry-with-backoff',
      2,
      `
do:
  - guarded:
      try:
        - fetch: { call: execute_spec, with: { primitive: inference, name: flaky, input: { key: backoff } } }
      catch:
        errors: { with: { status: 503 } }
        retry: { delay: { milliseconds: 500 }, backoff: { exponential: {} }, limit: { attempt: { count: 3 } } }
`,
    );
    const attempts = harness.executions().filter(({ name }) => name === 'flaky');

    expect(output).toEqual({ calls: 3 });
    expect(new Set(attempts.map(({ executionId }) => executionId)).size).toBe(3);
    expect(Date.now() - before).toBeGreaterThanOrEqual(1500);
  }, 60_000);
});

describe('the orchestration worker running steps at once and waiting', () => {
  it('runs the branches of a fork in parallel', async () => {
    const { output } = await ran(
      'parallel-fork',
      3,
      `
do:
  - both:
      fork:
        branches:
          - left: { call: execute_spec, with: { primitive: inference, name: left } }
          - right: { call: execute_spec, with: { primitive: inference, name: right } }
`,
    );

    expect(output).toEqual([{ summary: 'left of {}' }, { summary: 'right of {}' }]);
  }, 60_000);

  it('waits on a durable timer', async () => {
    const before = Date.now();
    const { output } = await ran('timer', 4, 'do:\n  - pause: { wait: { milliseconds: 1200 } }', { waited: true });

    expect(output).toEqual({ waited: true });
    expect(Date.now() - before).toBeGreaterThanOrEqual(1200);
  }, 60_000);
});
