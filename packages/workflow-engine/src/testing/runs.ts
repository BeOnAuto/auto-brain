import { callKeyText, type CallKey } from '../executor/call-key.ts';
import type { RunInput } from '../machine/run-input.ts';
import { newRun, type RunState, type TaskFrame } from '../machine/run-state.ts';

export const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const openCall: CallKey = { executionId, reference: '/do/1/fork/branches/0/ask', run: 1 };

export const armedTimer = `${executionId}/timers/1`;

const waiting: TaskFrame = {
  reference: '/do/1/fork/branches/1/pause',
  run: 1,
  rawInput: { ticket: 7 },
  input: { ticket: 7 },
  variables: {},
  timeout: null,
  body: { kind: 'wait', timer: armedTimer },
};

const asking: TaskFrame = {
  reference: openCall.reference,
  run: 1,
  rawInput: { ticket: 7 },
  input: { ticket: 7 },
  variables: { attempt: 1 },
  timeout: `${executionId}/timers/2`,
  body: { kind: 'call', key: openCall },
};

const forking: TaskFrame = {
  reference: '/do/1',
  run: 1,
  rawInput: { ticket: 7 },
  input: { ticket: 7 },
  variables: {},
  timeout: null,
  body: {
    kind: 'fork',
    compete: true,
    branches: [
      { state: 'running', task: asking },
      { state: 'running', task: waiting },
      { state: 'failed', error: { type: 'runtime', status: 500, instance: '/do/1/fork/branches/2' } },
    ],
  },
};

export const runningState: RunState = {
  ...newRun,
  executionId,
  status: 'running',
  workflow: { document: { document: { dsl: '1.0.3' }, do: [] }, input: { ticket: 7 } },
  attributes: { owner: 'tests' },
  limits: { mostDurationMs: 2_592_000_000, longestCallMs: 600_000 },
  startedAt: 1_791_100_000_000,
  lastInputAt: 1_791_100_000_000,
  random: { seed: 42, draws: 1 },
  timers: {
    next: 3,
    armed: {
      [armedTimer]: { purpose: 'wait', reference: waiting.reference },
      [`${executionId}/timers/2`]: { purpose: 'timeout', reference: asking.reference },
    },
  },
  calls: { runs: { [openCall.reference]: 1 }, open: { [callKeyText(openCall)]: openCall } },
  inbox: {
    waiting: [{ event: { id: 'event-2', type: 'com.acme.approval', data: { approved: true } }, bytes: 80 }],
    waitingBytes: 80,
    receivedIds: ['event-1', 'event-2'],
    received: 2,
    receivedBytes: 160,
    overflow: null,
  },
  heldBytes: 9000,
  stepsWithoutWaiting: 0,
  machine: {
    context: { seen: 1 },
    root: {
      reference: '/',
      run: 1,
      rawInput: { ticket: 7 },
      input: { ticket: 7 },
      variables: {},
      timeout: null,
      body: {
        kind: 'list',
        list: { pointer: '/do', position: 1, data: { ticket: 7 }, variables: {}, current: forking },
      },
    },
  },
};

export const at = 1_791_100_060_000;

export const started: RunInput = {
  kind: 'started',
  executionId,
  at,
  document: { document: { dsl: '1.0.3' }, do: [] },
  input: { ticket: 7 },
  limits: { mostDurationMs: 2_592_000_000, longestCallMs: 600_000 },
  attributes: { owner: 'tests' },
  seed: 42,
};
