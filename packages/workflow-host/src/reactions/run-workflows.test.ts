import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflowsOfRuns } from './run-workflows.ts';

const brainKey = 'brain/acme/alpha/';

function startedRecord(type: string, name: string) {
  return {
    type: 'run_started',
    data: { input: {} },
    context: { by: 'acme-admin', at: 'now', definitionType: type, definitionName: name, definitionVersion: 1 },
  };
}

const streams: ReadonlyMap<string, readonly unknown[]> = new Map([
  [`${brainKey}runs/r-close`, [startedRecord('workflow', 'close')]],
  [`${brainKey}runs/r-sum`, [startedRecord('reasoning', 'sum')]],
]);

function counting() {
  const reads: string[] = [];
  const read = (stream: string) => {
    reads.push(stream.slice(brainKey.length));
    return Promise.resolve({ messages: streams.get(stream) ?? [] });
  };
  return { read, reads: () => reads };
}

describe('the workflow of a run', () => {
  it('is the name the run started, when it is a workflow, and is read once while it is remembered', async () => {
    const { read, reads } = counting();
    const workflowOf = workflowsOfRuns(read, 'workflow', 3);

    const workflows = await Effect.runPromise(
      Effect.forEach(['r-close', 'r-sum', 'r-unknown', 'r-close', 'r-other', 'r-close'], (runId) =>
        workflowOf(brainKey, runId),
      ),
    );

    expect(workflows).toEqual(['close', undefined, undefined, 'close', undefined, 'close']);
    expect(reads()).toEqual(['runs/r-close', 'runs/r-sum', 'runs/r-unknown', 'runs/r-other', 'runs/r-close']);
  });
});
