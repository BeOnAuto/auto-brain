import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';

import { probeWorkflowsPath, recordedHistories, type RecordedHistory } from '../../replay-corpus.ts';
import type { WorkflowCode } from '../worker/orchestration-worker.ts';
import { buildWorkflowBundle } from '../worker/workflow-bundle.ts';
import { failureConverterPath } from '../worker/workflow-code.ts';

interface Replayed {
  readonly workflowId: string;
  readonly failure: string | undefined;
}

async function replayed(code: WorkflowCode, histories: readonly RecordedHistory[]): Promise<readonly Replayed[]> {
  const results: Replayed[] = [];
  for await (const result of Worker.runReplayHistories(
    { ...code, dataConverter: { failureConverterPath }, replayName: 'corpus' },
    histories,
  )) {
    results.push({
      workflowId: result.workflowId,
      failure: result.error === undefined ? undefined : String(result.error),
    });
  }
  return results;
}

function replayedCleanly(histories: readonly RecordedHistory[]): readonly Replayed[] {
  return histories.map(({ workflowId }) => ({ workflowId, failure: undefined }));
}

describe('the recorded histories of workflows', () => {
  it('replay against the interpreter as it is, so a change that breaks determinism fails here', async () => {
    const results = await replayed({ workflowsPath: probeWorkflowsPath }, recordedHistories());

    expect(results).toEqual(replayedCleanly(recordedHistories()));
    expect(results.length).toBeGreaterThanOrEqual(8);
  }, 60_000);

  it('replay the same against the bundle an image ships, built ahead of time from the same code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workflow-bundle-'));
    const codePath = await buildWorkflowBundle(directory);
    const histories = recordedHistories().filter(({ workflowId }) => workflowId !== 'temporal-global');

    const results = await replayed({ workflowBundle: { codePath } }, histories);
    await rm(directory, { recursive: true, force: true });

    expect(results).toEqual(replayedCleanly(histories));
    expect(results.length).toBeGreaterThanOrEqual(14);
  }, 60_000);
});
