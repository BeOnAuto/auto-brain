import { fileURLToPath } from 'node:url';

import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';

import { probeWorkflowsPath, recordedHistories } from '../../replay-corpus.ts';

const failureConverterPath = fileURLToPath(new URL('../worker/failure-converter.ts', import.meta.url));

interface Replayed {
  readonly workflowId: string;
  readonly failure: string | undefined;
}

async function replayed(): Promise<readonly Replayed[]> {
  const results: Replayed[] = [];
  for await (const result of Worker.runReplayHistories(
    { workflowsPath: probeWorkflowsPath, dataConverter: { failureConverterPath }, replayName: 'corpus' },
    recordedHistories(),
  )) {
    results.push({
      workflowId: result.workflowId,
      failure: result.error === undefined ? undefined : String(result.error),
    });
  }
  return results;
}

describe('the recorded histories of workflows', () => {
  it('replay against the interpreter as it is, so a change that breaks determinism fails here', async () => {
    const results = await replayed();

    expect(results).toEqual(recordedHistories().map(({ workflowId }) => ({ workflowId, failure: undefined })));
    expect(results.length).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
