import { memoryLedger } from '@beonauto/operations/testing';
import type { RunStart, WorkflowHost } from '@beonauto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainOn } from '../testing/brain.ts';
import { acmeCaller } from '../testing/workflows.ts';
import { makeWorkflowAdapter } from './workflow.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-555555555552';

const flow = "document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: []\n";

describe('the run an execution of a workflow starts', () => {
  it('is known by its brain, its execution, its version, its caller, its reaction depth and its lineage', async () => {
    const starts: RunStart[] = [];
    const recording: Pick<WorkflowHost, 'start'> = {
      start: (_run, start) =>
        Effect.sync(() => {
          starts.push(start);
          return 'started';
        }),
    };
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
        lineage: { correlation: executionId },
      },
    ]);
  });
});
