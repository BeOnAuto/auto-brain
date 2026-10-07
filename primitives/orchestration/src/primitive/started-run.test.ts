import { memoryLedger } from '@beonauto/operations/testing';
import { echo } from '@beonauto/specs/testing';
import type { RunStart, WorkflowHost } from '@beonauto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainOn } from '../testing/brain.ts';
import { acmeCaller } from '../testing/workflows.ts';
import { makeWorkflowAdapter } from './workflow.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-555555555552';

const flow = "document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: []\n";

const calling = [
  "document: { dsl: '1.0.3', namespace: acme, name: calling, version: '1.0.0' }",
  'do:',
  '  - greet: { call: execute_spec, with: { primitive: echo, name: greet } }',
  '  - nested: { call: execute_spec, with: { primitive: orchestration, name: flow } }',
].join('\n');

function recordingStarts() {
  const starts: RunStart[] = [];
  const recording: Pick<WorkflowHost, 'start'> = {
    start: (_run, start) =>
      Effect.sync(() => {
        starts.push(start);
        return 'started';
      }),
  };
  return { starts, recording };
}

describe('the run an execution of a workflow starts', () => {
  it('is known by its brain, its execution, its version, its caller, its reaction depth and its lineage', async () => {
    const { starts, recording } = recordingStarts();
    const brain = brainOn(memoryLedger(), [
      makeWorkflowAdapter({ runs: recording, mostDurationMs: 2_592_000_000, longestCallMs: 1000 }),
    ]);
    await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'flow', source: flow });

    await brain.call(brain.executeSpec, { primitive: 'orchestration', name: 'flow', execution_id: executionId });

    expect(starts.map(({ attributes }) => attributes)).toMatchObject([
      {
        org: 'acme',
        brain: 'alpha',
        execution_id: executionId,
        spec: { name: 'flow', version: 1 },
        caller: acmeCaller,
        depth: 0,
        call_depth: 0,
        lineage: { correlation: executionId },
      },
    ]);
  });

  it('waits for each call that names its definition no longer than that definition may run, with a minute more', async () => {
    const { starts, recording } = recordingStarts();
    const brain = brainOn(memoryLedger(), [
      makeWorkflowAdapter({ runs: recording, mostDurationMs: 2_592_000_000, longestCallMs: 1000 }),
      echo,
    ]);
    await brain.call(brain.createSpec, { primitive: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
    await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'flow', source: flow });
    await brain.call(brain.createSpec, { primitive: 'orchestration', name: 'calling', source: calling });

    await brain.call(brain.executeSpec, { primitive: 'orchestration', name: 'calling', execution_id: executionId });

    expect(starts.map(({ limits }) => limits)).toEqual([
      {
        mostDurationMs: 2_592_000_000,
        longestCallMs: 1000,
        longestCallMsByTask: { '/do/0/greet': 660_000, '/do/1/nested': 2_592_060_000 },
      },
    ]);
  });
});
