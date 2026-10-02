import { describe, expect, it } from 'vitest';

import type { SettleRequest } from '../interpreter/host.ts';
import { FakeCancellation } from '../testing/fake-cancellation.ts';
import { fakeWorkflowApi } from '../testing/fake-workflow-api.ts';
import { acmeCaller } from '../testing/workflows.ts';
import { settleSettings, temporalHost } from './temporal-host.ts';

const call = {
  org: 'acme',
  brain: 'alpha',
  caller: acmeCaller,
  reference: '/do/0/summarize',
  run: 2,
  primitive: 'inference',
  name: 'summarize',
  input: { text: 'long' },
};

describe('the Temporal host of a workflow', () => {
  it('reads the time, a random number and the size of the history from the workflow', () => {
    const host = temporalHost(fakeWorkflowApi().api);

    expect(typeof host.now()).toBe('number');
    expect(host.random()).toBeLessThan(1);
    expect(host.historySize()).toEqual({ bytes: 1024, events: 12 });
  });

  it('sleeps on a timer with a summary, and waits on a condition', async () => {
    const fake = fakeWorkflowApi();
    const host = temporalHost(fake.api);

    await host.sleep(1500, '/do/0/pause');
    await host.waitUntil(() => true);
    void host.deadline(7_200_000);

    expect(fake.calls()).toEqual([
      { name: 'sleep', milliseconds: 1500, summary: '/do/0/pause' },
      { name: 'condition' },
      { name: 'sleep', milliseconds: 7_200_000, summary: 'the most the workflow may run' },
    ]);
  });

  it('tells a cancellation from other errors', () => {
    const host = temporalHost(fakeWorkflowApi().api);

    expect([host.isCancellation(new FakeCancellation()), host.isCancellation(new Error('no'))]).toEqual([true, false]);
  });
});

describe('the activities of the Temporal host', () => {
  it('execute a spec in an activity named by the task reference and its run', async () => {
    const fake = fakeWorkflowApi({ answer: { status: 'succeeded', output: 'short' } });

    expect(await temporalHost(fake.api).executeSpec(call)).toEqual({ status: 'succeeded', output: 'short' });
    expect(fake.calls()).toEqual([
      {
        name: 'proxyActivities',
        settings: {
          activityId: '/do/0/summarize#2',
          summary: '/do/0/summarize executes the inference spec summarize',
          startToCloseTimeout: '10 minutes',
          retry: {
            initialInterval: '1 second',
            backoffCoefficient: 2,
            maximumInterval: '1 minute',
            maximumAttempts: 5,
          },
        },
      },
      { name: 'executeSpec', call },
    ]);
  });

  it('settle the execution in a local activity no cancellation reaches, so that it takes no slot of a nested execution', async () => {
    const fake = fakeWorkflowApi();
    const request: SettleRequest = {
      org: 'acme',
      brain: 'alpha',
      spec: 'flow',
      executionId: 'e',
      settlement: { status: 'failed' },
    };

    await temporalHost(fake.api).settle(request);

    expect(fake.calls()).toEqual([
      { name: 'scope', event: 'non-cancellable' },
      { name: 'proxyLocalActivities', settings: settleSettings },
      { name: 'settleExecution', request },
    ]);
  });
});

function retryWaits({ backoffCoefficient, maximumAttempts }: typeof settleSettings.retry): readonly number[] {
  return Array.from({ length: maximumAttempts - 1 }, (_, retry) =>
    Math.min(1000 * backoffCoefficient ** retry, 60_000),
  );
}

describe('the retries of settling', () => {
  it('make 20 attempts, from a second apart doubling up to a minute, about 14 minutes in all, waiting on timers of the workflow after the first', () => {
    const waited = retryWaits(settleSettings.retry).reduce((total, wait) => total + wait, 0);

    expect(settleSettings.localRetryThreshold).toBe('1 second');
    expect(settleSettings.retry).toStrictEqual({
      initialInterval: '1 second',
      backoffCoefficient: 2,
      maximumInterval: '1 minute',
      maximumAttempts: 20,
    });
    expect(waited).toBe(843_000);
  });
});

describe('the cancellation scopes of the Temporal host', () => {
  it('run work in a scope of its own that can be cancelled', async () => {
    const fake = fakeWorkflowApi();
    const scope = temporalHost(fake.api).cancellable(() => Promise.resolve(7));
    scope.cancel();

    expect(await scope.result).toBe(7);
    expect(fake.calls()).toEqual([
      { name: 'scope', event: 'run' },
      { name: 'scope', event: 'cancel' },
    ]);
  });
});
