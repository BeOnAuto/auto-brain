import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordHistory } from '../../replay-corpus.ts';
import type { JsonObject } from '../dsl/json.ts';
import { temporalHarness, type TemporalHarness } from '../testing/temporal.ts';
import { runFor, workflow } from '../testing/workflows.ts';

let harness: TemporalHarness;

beforeAll(async () => {
  harness = await temporalHarness('command-paths');
}, 60_000);

afterAll(async () => {
  await harness.close();
}, 60_000);

function idOf(number: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(number).padStart(12, '0')}`;
}

async function recorded(name: string, number: number, source: string, events: readonly JsonObject[] = []) {
  const executionId = idOf(number);
  const started = await Effect.runPromise(harness.orchestration.start(runFor(workflow(source), executionId, {})));
  const workflowAddress = { org: 'acme', brain: 'alpha', spec: 'test-flow', executionId };
  await Effect.runPromise(Effect.forEach(events, (event) => harness.orchestration.signal(workflowAddress, event)));
  const handle = harness.temporal.workflow.getHandle(started.workflowId);
  const output: unknown = await handle.result();
  await recordHistory(name, () => handle.fetchHistory());
  return output;
}

describe('the paths of a workflow that issue commands', () => {
  it('take events sent while a listen waits', async () => {
    const output = await recorded(
      'listen-signals',
      101,
      'do:\n  - await: { listen: { to: { one: { with: { type: approved } } } } }',
      [
        { id: 'e1', type: 'declined', data: 'no' },
        { id: 'e2', type: 'approved', data: 'yes' },
      ],
    );

    expect(output).toEqual(['yes']);
  }, 60_000);

  it('wait inside a for loop', async () => {
    const source = `
do:
  - each:
      for: { in: '\${ [1, 2] }' }
      do:
        - pause: { wait: { milliseconds: 200 } }
        - add: { set: { total: '\${ (.total // 0) + $item }' } }
`;

    expect(await recorded('for-with-wait', 102, source)).toEqual({ total: 3 });
  }, 60_000);
});

describe('the paths of a workflow that runs branches or recovers', () => {
  it('race the branches of a fork that competes, cancelling the slower', async () => {
    const source = `
do:
  - race:
      fork:
        compete: true
        branches:
          - slow: { do: [{ pause: { wait: PT5S } }, { done: { set: { won: slow } } }] }
          - quick: { set: { won: quick } }
`;

    expect(await recorded('fork-compete', 103, source)).toEqual({ won: 'quick' });
  }, 60_000);

  it('recover from a caught error through catch.do', async () => {
    const source = `
do:
  - guarded:
      try:
        - fail: { raise: { error: { type: https://example.com/errors/busy, status: 503 } } }
      catch:
        errors: { with: { status: 503 } }
        do:
          - recover: { set: { recovered: true } }
`;

    expect(await recorded('catch-do-recovery', 104, source)).toEqual({ recovered: true });
  }, 60_000);
});

describe('the paths of a workflow that time out or branch', () => {
  it('fire a timeout, and catch it', async () => {
    const source = `
do:
  - guarded:
      try:
        - slow: { wait: PT5S, timeout: { after: { milliseconds: 300 } } }
      catch:
        errors: { with: { status: 408 } }
        do:
          - late: { set: { timedOut: true } }
`;

    expect(await recorded('timeout-fires', 105, source)).toEqual({ timedOut: true });
  }, 60_000);

  it('choose a case of a switch', async () => {
    const source = `
do:
  - decide:
      switch:
        - big: { when: '\${ false }', then: large }
        - otherwise: { then: small }
  - large: { set: { size: large }, then: end }
  - small: { set: { size: small } }
`;

    expect(await recorded('switch', 106, source)).toEqual({ size: 'small' });
  }, 60_000);

  it('jump back to an earlier task with then', async () => {
    const source = `
do:
  - count: { set: { n: '\${ (.n // 0) + 1 }' } }
  - again: { if: '\${ .n < 3 }', wait: { milliseconds: 100 }, then: count }
`;

    expect(await recorded('then-jump-back', 107, source)).toEqual({ n: 3 });
  }, 60_000);
});
