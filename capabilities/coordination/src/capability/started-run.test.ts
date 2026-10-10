import { echo, noLongestRuns, recordingJournal } from '@beonauto/definitions/testing';
import { memoryLedger } from '@beonauto/operations/testing';
import type { RunStart, WorkflowHost } from '@beonauto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainOn } from '../testing/brain.ts';
import { testExpressionCheck } from '../testing/expression-checks.ts';
import { acmeCaller } from '../testing/workflows.ts';
import { makeWorkflowAdapter } from './workflow.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-555555555552';

const flow = "document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: []\n";

const calling = [
  "document: { dsl: '1.0.3', namespace: acme, name: calling, version: '1.0.0' }",
  'do:',
  '  - greet: { call: run_definition, with: { type: echo, name: greet } }',
  '  - nested: { call: run_definition, with: { type: workflow, name: flow } }',
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

function recordingWorkflows(recording: Pick<WorkflowHost, 'start'>) {
  return makeWorkflowAdapter({
    runs: recording,
    check: testExpressionCheck,
    mostDurationMs: 2_592_000_000,
    longestCallMs: 1000,
  });
}

describe('the run a run of a workflow starts', () => {
  it('is known by its brain, its run, its version, its caller, its reaction depth and its lineage', async () => {
    const { starts, recording } = recordingStarts();
    const brain = brainOn(memoryLedger(), [recordingWorkflows(recording)]);
    await brain.call(brain.createDefinition, { type: 'workflow', name: 'flow', source: flow });

    await brain.call(brain.runDefinition, { type: 'workflow', name: 'flow', run_id: runId });

    expect(starts.map(({ attributes }) => attributes)).toMatchObject([
      {
        org: 'acme',
        brain: 'alpha',
        run_id: runId,
        definition: { name: 'flow', version: 1 },
        caller: acmeCaller,
        depth: 0,
        call_depth: 0,
        lineage: { correlation: runId },
      },
    ]);
  });
});

describe('the run a run of a workflow starts for a call or a trigger', () => {
  it('carries the call that started it and the trigger that started it, when it has them', async () => {
    const { starts, recording } = recordingStarts();
    const prepared = Effect.runSync(recordingWorkflows(recording).prepare(flow));
    const context = {
      id: runId,
      org: 'acme',
      brain: 'alpha',
      caller: acmeCaller,
      definition: { name: 'flow', version: 1 },
      journal: recordingJournal(),
      lineage: { startId: 'start-1', correlationId: 'root-1' },
      depth: 1,
      callDepth: 1,
      calledBy: { run_id: 'r-0', reference: '/do/0/flow', run: 1 },
      trigger: { kind: 'event', reference: '/schedule/on' },
      longestRunOf: noLongestRuns,
    } as const;

    await Effect.runPromise(prepared.run({}, context));

    expect(starts.map(({ attributes }) => attributes)).toMatchObject([
      {
        called_by: { run_id: 'r-0', reference: '/do/0/flow', run: 1 },
        trigger: { kind: 'event', reference: '/schedule/on' },
      },
    ]);
  });
});

describe('the calls of the run a run of a workflow starts', () => {
  it('waits for each call that names its definition no longer than that definition may run, with a minute more', async () => {
    const { starts, recording } = recordingStarts();
    const brain = brainOn(memoryLedger(), [recordingWorkflows(recording), echo]);
    await brain.call(brain.createDefinition, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
    await brain.call(brain.createDefinition, { type: 'workflow', name: 'flow', source: flow });
    await brain.call(brain.createDefinition, { type: 'workflow', name: 'calling', source: calling });

    await brain.call(brain.runDefinition, { type: 'workflow', name: 'calling', run_id: runId });

    expect(starts.map(({ limits }) => limits)).toEqual([
      {
        mostDurationMs: 2_592_000_000,
        longestCallMs: 1000,
        longestCallMsByTask: { '/do/0/greet': 660_000, '/do/1/nested': 2_592_060_000 },
      },
    ]);
  });
});
