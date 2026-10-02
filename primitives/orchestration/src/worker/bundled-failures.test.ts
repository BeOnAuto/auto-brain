import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { temporalHarness, type TemporalHarness } from '../testing/temporal.ts';
import { runFor, workflow } from '../testing/workflows.ts';
import { buildWorkflowBundle } from './workflow-bundle.ts';

let directory: string;

let harness: TemporalHarness;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'bundled-failures-'));
  harness = await temporalHarness('bundled-failures', { workflowBundle: await buildWorkflowBundle(directory) });
}, 60_000);

afterAll(async () => {
  await harness.close();
  await rm(directory, { recursive: true, force: true });
}, 60_000);

describe('a workflow that fails in a worker running the bundle built ahead of time', () => {
  it('records its failure without a stack trace, since the bundle carries the failure converter', async () => {
    const run = runFor(
      workflow('do:\n  - reject: { raise: { error: { type: https://example.com/no, status: 422, title: No } } }'),
      '0199a3c4-7d2e-7c1a-9b3f-777777777771',
    );
    const { workflowId } = await Effect.runPromise(harness.orchestration.start(run));
    const handle = harness.temporal.workflow.getHandle(workflowId);
    await handle.result().catch((error: unknown) => error);
    const history = await handle.fetchHistory();

    expect(history.events?.at(-1)?.workflowExecutionFailedEventAttributes?.failure).toMatchObject({
      message: 'No (at /do/0/reject)',
      stackTrace: '',
      applicationFailureInfo: { type: 'UncaughtError' },
    });
  }, 60_000);
});
