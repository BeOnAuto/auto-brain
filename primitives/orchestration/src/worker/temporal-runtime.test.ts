import { setTimeout } from 'node:timers/promises';

import { ApplicationFailure } from '@temporalio/common';
import { Runtime } from '@temporalio/worker';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installTemporalRuntime,
  runtimeShutdownSignals,
  watchTemporal,
  type TemporalLogEntry,
} from './temporal-runtime.ts';

const marker = 'MARKER-of-the-tenant';

const entries: TemporalLogEntry[] = [];

installTemporalRuntime((entry) => {
  entries.push(entry);
});

beforeEach(() => {
  entries.length = 0;
});

async function forwardedOf(log: () => void): Promise<readonly TemporalLogEntry[]> {
  log();
  Runtime.instance().logger.error('end of the case');
  await vi.waitFor(
    () => {
      expect(entries.at(-1)?.message).toBe('Temporal reported: end of the case');
    },
    { timeout: 10_000 },
  );
  return entries.slice(0, -1);
}

function answeringAfter(failures: number) {
  let probes = 0;
  return {
    reach: (): Promise<void> => {
      probes += 1;
      return probes > failures ? Promise.resolve() : Promise.reject(new Error('Temporal is still down'));
    },
    probes: () => probes,
  };
}

const ids = { namespace: 'default', taskQueue: 'brains', workflowId: 'acme/alpha/flow/e', runId: 'r1' };

describe("Temporal's runtime installed for a server", () => {
  it('handles no signals, and keeps the first logger when installed again', async () => {
    installTemporalRuntime(() => {
      entries.push({ level: 'ERROR', message: 'installed twice', context: {} });
    });

    const forwarded = await forwardedOf(() => {
      Runtime.instance().logger.error('Worker failed');
    });

    expect(runtimeShutdownSignals()).toStrictEqual([]);
    expect(forwarded).toStrictEqual([{ level: 'ERROR', message: 'Temporal reported: Worker failed', context: {} }]);
  });

  it('forwards nothing below a warning', async () => {
    const forwarded = await forwardedOf(() => {
      Runtime.instance().logger.info('Worker state changed', { taskQueue: 'brains' });
    });

    expect(forwarded).toStrictEqual([]);
  });
});

describe('a workflow failing in Temporal', () => {
  it('is not forwarded, whatever failed it, since only the run of a tenant fails a workflow', async () => {
    const forwarded = await forwardedOf(() => {
      Runtime.instance().logger.warn('Workflow failed', {
        ...ids,
        sdkComponent: 'worker',
        error: ApplicationFailure.nonRetryable(`${marker} (at /do/0/no)`, 'UncaughtError'),
      });
    });

    expect(forwarded).toStrictEqual([]);
  });

  it('is forwarded with its type when the workflow says it failed for a fault of the runtime', async () => {
    const forwarded = await forwardedOf(() => {
      Runtime.instance().logger.error('The workflow failed for a fault of the runtime', {
        ...ids,
        sdkComponent: 'workflow',
        workflowType: 'runWorkflowSpec',
        failureType: 'WorkflowBrokeDown',
      });
    });

    expect(forwarded).toStrictEqual([
      {
        level: 'ERROR',
        message: 'Temporal reported: The workflow failed for a fault of the runtime',
        context: {
          ...ids,
          sdkComponent: 'workflow',
          workflowType: 'runWorkflowSpec',
          failureType: 'WorkflowBrokeDown',
        },
      },
    ]);
  });
});

describe('a workflow task failing', () => {
  it('is forwarded with the code of a nondeterminism error, and never the text of the failure', async () => {
    const forwarded = await forwardedOf(() => {
      Runtime.instance().logger.warn('Failing workflow task', {
        sdkComponent: 'core',
        target: 'temporalio_sdk_core::worker::workflow',
        runId: 'r1',
        failure: `Failure { failure: Some(Failure { message: "[TMPRL1100] Nondeterminism error: ${marker}", source: "" }) }`,
      });
      Runtime.instance().logger.warn('Failing workflow task', {
        sdkComponent: 'core',
        runId: 'r2',
        failure: `Failure { failure: Some(Failure { message: "${marker}", source: "TypeScriptSDK" }) }`,
      });
    });

    expect(forwarded).toStrictEqual([
      {
        level: 'WARN',
        message: 'Temporal reported: Failing workflow task',
        context: { sdkComponent: 'core', runId: 'r1', failureCode: 'TMPRL1100' },
      },
      {
        level: 'WARN',
        message: 'Temporal reported: Failing workflow task',
        context: { sdkComponent: 'core', runId: 'r2' },
      },
    ]);
  });
});

describe('an activity failing', () => {
  it('is forwarded with the type of the error and the fields that describe it, never its text, input or headers', async () => {
    const forwarded = await forwardedOf(() => {
      Runtime.instance().logger.warn('Activity failed', {
        ...ids,
        workflowRunId: 'r1',
        activityType: 'settleExecution',
        activityId: `/do/0/${marker}#1`,
        attempt: 2,
        isLocal: false,
        error: ApplicationFailure.retryable(marker, 'SettlementBroken'),
        activityInput: { secret: marker },
        headers: { authorization: marker },
      });
      Runtime.instance().logger.warn('Activity failed', { error: new TypeError(marker) });
    });

    expect(JSON.stringify(forwarded)).not.toContain(marker);
    expect(forwarded).toStrictEqual([
      {
        level: 'WARN',
        message: 'Temporal reported: Activity failed',
        context: {
          ...ids,
          workflowRunId: 'r1',
          activityType: 'settleExecution',
          attempt: 2,
          errorType: 'SettlementBroken',
        },
      },
      { level: 'WARN', message: 'Temporal reported: Activity failed', context: { errorType: 'TypeError' } },
    ]);
  });
});

describe('what Temporal reports with text that is not its own', () => {
  it('is forwarded with the code of the error and the message up to its first colon', async () => {
    const forwarded = await forwardedOf(() => {
      Runtime.instance().logger.warn('Worker heartbeat failed', {
        sdkComponent: 'core',
        error: `Status { code: DeadlineExceeded, message: "${marker}" }`,
      });
      Runtime.instance().logger.warn('Worker heartbeat failed', { error: 'refused' });
      Runtime.instance().logger.error(`Error while processing ActivityTask.start: ${marker}`, { failure: 7 });
    });

    expect(JSON.stringify(forwarded)).not.toContain(marker);
    expect(forwarded).toStrictEqual([
      {
        level: 'WARN',
        message: 'Temporal reported: Worker heartbeat failed',
        context: { sdkComponent: 'core', errorCode: 'DeadlineExceeded' },
      },
      { level: 'WARN', message: 'Temporal reported: Worker heartbeat failed', context: {} },
      { level: 'ERROR', message: 'Temporal reported: Error while processing ActivityTask.start', context: {} },
    ]);
  });

  it('is cut at 500 characters', async () => {
    const forwarded = await forwardedOf(() => {
      Runtime.instance().logger.warn('w'.repeat(600), { workflowId: 'i'.repeat(600) });
    });

    expect(forwarded).toStrictEqual([
      { level: 'WARN', message: `Temporal reported: ${'w'.repeat(481)}`, context: { workflowId: 'i'.repeat(500) } },
    ]);
  });
});

describe('a worker that loses Temporal', () => {
  it('logs one warning however often Temporal retries, and one line once a probe reaches Temporal again', async () => {
    const probe = answeringAfter(2);
    const unwatch = watchTemporal(probe.reach, 20);

    const lost = await forwardedOf(() => {
      for (const poll of ['poll_workflow_task_queue', 'poll_activity_task_queue', 'poll_workflow_task_queue']) {
        Runtime.instance().logger.warn(`gRPC call ${poll} retried 6 times`, {
          sdkComponent: 'core',
          error: 'Status { code: Unavailable, message: "tcp connect error" }',
        });
      }
      Runtime.instance().logger.warn('Network error while sending worker heartbeat', { sdkComponent: 'core' });
    });
    await vi.waitFor(
      () => {
        expect(entries.at(-1)?.message).toBe('The workflow worker reached Temporal again');
      },
      { timeout: 10_000 },
    );
    unwatch();
    unwatch();

    expect(lost).toStrictEqual([
      {
        level: 'WARN',
        message: 'The workflow worker lost Temporal',
        context: { sdkComponent: 'core', errorCode: 'Unavailable' },
      },
    ]);
    expect(entries.at(-1)?.level).toBe('INFO');
    expect(typeof entries.at(-1)?.context['lost_for_ms']).toBe('number');
    expect(probe.probes()).toBe(3);
  });

  it('is not probed when no worker watches Temporal', async () => {
    const lost = await forwardedOf(() => {
      Runtime.instance().logger.warn('gRPC call poll_workflow_task_queue retried 6 times', { sdkComponent: 'core' });
    });
    await setTimeout(100);

    expect(lost).toStrictEqual([
      { level: 'WARN', message: 'The workflow worker lost Temporal', context: { sdkComponent: 'core' } },
    ]);
    expect(entries.at(-1)?.message).toBe('Temporal reported: end of the case');
  });
});
