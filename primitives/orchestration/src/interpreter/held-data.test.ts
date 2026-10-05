import { describe, expect, it } from 'vitest';

import { interpret, workflow, onMachine } from '../testing/workflows.ts';
import { mostHeldBytes } from './holding.ts';
import type { RunSettlement } from './host.ts';

function branch(name: string): string {
  return `- ${name}: { do: [{ big: { set: { s: '\${ "x" * 2000000 }' } } }, { rest: { wait: PT1H } }] }`;
}

function rejectionDetailOf(settlement: RunSettlement | undefined): string {
  return settlement?.status === 'rejected' ? settlement.detail : '';
}

describe('the data a workflow holds at once', () => {
  it.skipIf(onMachine)(
    'counts what every running task holds, so branches that each keep a large value fail the workflow',
    async () => {
      const document = workflow(
        `do:\n  - spread:\n      fork:\n        branches:\n${['a', 'b', 'c', 'd', 'e'].map((name) => `          ${branch(name)}`).join('\n')}\n`,
      );

      const { settlement } = await interpret(document);

      expect(settlement).toMatchObject({ status: 'rejected', reason: 'unavailable' });
      expect(rejectionDetailOf(settlement)).toMatch(
        new RegExp(
          `^The workflow would hold about \\d+ bytes of data at once, more than the ${mostHeldBytes} a workflow may hold \\(at /do/0/spread/fork/branches/\\d+/\\w/do/\\d+/(big|rest)\\)$`,
          'u',
        ),
      );
    },
  );

  it.skipIf(onMachine)('lets go of what a task held once it finishes, so large values in turn fit', async () => {
    const step = `{ set: { s: '\${ "x" * 3000000 }' } }`;
    const steps = ['a', 'b', 'c', 'd', 'e'].map((name) => `  - ${name}: ${step}`).join('\n');
    const document = workflow(`do:\n${steps}\n  - done: { set: { done: true } }\n`);

    const { ending } = await interpret(document);

    expect(ending).toEqual({ kind: 'completed', output: { done: true } });
  });
});
