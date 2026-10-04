import {
  mostReceivedEventBytes,
  mostReceivedEvents,
  mostWaitingEventBytes,
  mostWaitingEvents,
} from '@beonauto/workflow-engine/limits';
import { describe, expect, it } from 'vitest';

import type { FakeHost } from '../testing/fake-host.ts';
import { interpret, workflow } from '../testing/workflows.ts';
import type { RunSettlement } from './host.ts';
import type { WorkflowStart } from './interpreter.ts';

const waitingForever = workflow(`
do:
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.never }
`);

const consumingForever = workflow(`
do:
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.tick }
      then: await
`);

function flooding(count: number, event: (index: number) => unknown) {
  return (start: WorkflowStart, fake: FakeHost): void => {
    fake.at(1000, () => {
      for (let index = 0; index < count; index += 1) {
        start.deliver(event(index));
      }
    });
  };
}

const ranUntilItsDeadline = { status: 'failed' };

function rejectionDetailOf(settlement: RunSettlement | undefined): string {
  return settlement?.status === 'rejected' ? settlement.detail : '';
}

describe('events a workflow has not consumed', () => {
  it(`may number ${mostWaitingEvents}; one more fails the workflow, which settles at once`, async () => {
    const atTheLimit = await interpret(waitingForever, {
      started: flooding(mostWaitingEvents, (index) => ({ id: `e${index}`, type: 'com.acme.other' })),
    });
    const pastIt = await interpret(waitingForever, {
      started: flooding(mostWaitingEvents + 1, (index) => ({ id: `e${index}`, type: 'com.acme.other' })),
    });

    expect(atTheLimit.settlement).toEqual(ranUntilItsDeadline);
    expect(pastIt.settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: `The workflow was sent more events than it consumed: more than ${mostWaitingEvents} events or ${mostWaitingEventBytes} bytes waiting, the most a workflow holds (at /)`,
    });
  });

  it(`may hold ${mostWaitingEventBytes} bytes; more fails the workflow`, async () => {
    const big = 'x'.repeat(200_000);
    const { settlement } = await interpret(waitingForever, {
      started: flooding(4, (index) => ({ id: `e${index}`, type: 'com.acme.other', data: big })),
    });

    expect(rejectionDetailOf(settlement)).toContain(`${mostWaitingEventBytes} bytes waiting`);
  });
});

describe('events a workflow is sent over its life', () => {
  it(`may number ${mostReceivedEvents}, consumed or not, repeated ids included`, async () => {
    const { settlement } = await interpret(consumingForever, {
      started: flooding(mostReceivedEvents + 1, () => ({ id: 'same', type: 'com.acme.tick' })),
    });

    expect(rejectionDetailOf(settlement)).toContain(
      `The workflow was sent more than ${mostReceivedEvents} events or ${mostReceivedEventBytes} bytes of events, the most a workflow takes over its life`,
    );
  });

  it(`may take ${mostReceivedEventBytes} bytes, even when each is consumed`, async () => {
    const data = 'x'.repeat(200_000);
    const { settlement } = await interpret(consumingForever, {
      started: (start, fake) => {
        for (let index = 0; index < 22; index += 1) {
          fake.at(1000 * (index + 1), () => {
            start.deliver({ id: `e${index}`, type: 'com.acme.tick', data });
          });
        }
      },
    });

    expect(rejectionDetailOf(settlement)).toContain(`${mostReceivedEventBytes} bytes of events`);
  });

  it('do not count what is not JSON, which Temporal never delivers', async () => {
    const { settlement } = await interpret(consumingForever, {
      started: flooding(mostReceivedEvents + 1, () => Number.NaN),
    });

    expect(settlement).toEqual(ranUntilItsDeadline);
  });

  it('are taken as long as each is consumed and the total stays within the limits', async () => {
    const { settlement } = await interpret(consumingForever, {
      started: (start, fake) => {
        for (let index = 0; index < 20; index += 1) {
          fake.at(1000 * (index + 1), () => {
            start.deliver({ id: `e${index}`, type: 'com.acme.tick', data: index });
          });
        }
      },
    });

    expect(settlement).toEqual(ranUntilItsDeadline);
  });
});
