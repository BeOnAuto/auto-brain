import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunLimits } from '../machine/run-input.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import { workflow } from '../testing/workflows.ts';

const twoCalls = workflow(`
do:
  - both:
      fork:
        branches:
          - quick: { call: notify, with: { to: ada } }
          - slow: { call: notify, with: { to: grace } }
`);

const executionId = '0199a3c4-7d2e-7c1a-9b3f-000000000061';

function deadlinesOf(limits: Partial<RunLimits>) {
  const driver = memoryDriver({ respond: () => 'never' });
  driver.start({ executionId, document: twoCalls, limits });
  const [first] = Effect.runSync(driver.ports.runStore.eventsAfter(executionId, 0));
  return (first?.event.outputs ?? []).flatMap((output) =>
    output.kind === 'start_call' ? [{ reference: output.key.reference, longestMs: output.longestMs }] : [],
  );
}

describe('the deadline of a call', () => {
  it('is the limit its task was given when the run started, and the run-wide one for a task given none', () => {
    expect(
      deadlinesOf({
        longestCallMs: 600_000,
        longestCallMsByTask: { '/do/0/both/fork/branches/0/quick': 70_000 },
      }),
    ).toEqual([
      { reference: '/do/0/both/fork/branches/0/quick', longestMs: 70_000 },
      { reference: '/do/0/both/fork/branches/1/slow', longestMs: 600_000 },
    ]);
  });

  it('is cut to what the run has left to run', () => {
    expect(deadlinesOf({ mostDurationMs: 45_000, longestCallMs: 600_000 })).toEqual([
      { reference: '/do/0/both/fork/branches/0/quick', longestMs: 45_000 },
      { reference: '/do/0/both/fork/branches/1/slow', longestMs: 45_000 },
    ]);
  });
});
