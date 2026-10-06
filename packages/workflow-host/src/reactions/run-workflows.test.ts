import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflowsOfRuns } from './run-workflows.ts';

const brainKey = 'brain/acme/alpha/';

function startedRecord(primitive: string, name: string) {
  return { type: 'execution_started', primitive, name, spec_version: 1, input: {}, by: 'acme-admin', at: 'now' };
}

const streams: ReadonlyMap<string, readonly unknown[]> = new Map([
  [`${brainKey}executions/r-close`, [startedRecord('orchestration', 'close')]],
  [`${brainKey}executions/r-sum`, [startedRecord('inference', 'sum')]],
]);

function counting() {
  const reads: string[] = [];
  const read = (stream: string) => {
    reads.push(stream.slice(brainKey.length));
    return Promise.resolve({ events: streams.get(stream) ?? [] });
  };
  return { read, reads: () => reads };
}

describe('the workflow of a run', () => {
  it('is the name the run started, when it is a workflow, and is read once while it is remembered', async () => {
    const { read, reads } = counting();
    const workflowOf = workflowsOfRuns(read, 'orchestration', 3);

    const workflows = await Effect.runPromise(
      Effect.forEach(['r-close', 'r-sum', 'r-unknown', 'r-close', 'r-other', 'r-close'], (executionId) =>
        workflowOf(brainKey, executionId),
      ),
    );

    expect(workflows).toEqual(['close', undefined, undefined, 'close', undefined, 'close']);
    expect(reads()).toEqual([
      'executions/r-close',
      'executions/r-sum',
      'executions/r-unknown',
      'executions/r-other',
      'executions/r-close',
    ]);
  });
});
