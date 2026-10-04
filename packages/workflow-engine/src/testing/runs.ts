import { callKeyText, type CallKey } from '../executor/call-key.ts';
import { heldBytesOf } from '../machine/held-values.ts';
import type { Started } from '../machine/run-input.ts';
import { newRun, type RunState, type TaskFrame } from '../machine/run-state.ts';

export const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const document = { document: { dsl: '1.0.3', namespace: 'acme', name: 'triage', version: '1.0.0' }, do: [] };

export const openCall: CallKey = { executionId, reference: '/do/1/fork/branches/0/ask', run: 1 };

export const armedTimer = `${executionId}/timers/1`;

export const at = 1_791_100_060_000;

const ticket = 1;

const approval = 2;

const waiting: TaskFrame = {
  reference: '/do/1/fork/branches/1/pause',
  run: 1,
  startedAt: at - 60_000,
  context: 0,
  rawInput: ticket,
  input: ticket,
  variables: {},
  timeout: null,
  body: { kind: 'wait', timer: armedTimer },
};

const asking: TaskFrame = {
  reference: openCall.reference,
  run: 1,
  startedAt: at - 60_000,
  context: 0,
  rawInput: ticket,
  input: ticket,
  variables: { attempt: approval },
  timeout: `${executionId}/timers/2`,
  body: { kind: 'call', key: openCall, function: 'notify', arguments: ticket, label: 'notify the owner' },
};

const forking: TaskFrame = {
  reference: '/do/1',
  run: 1,
  startedAt: at - 60_000,
  context: 0,
  rawInput: ticket,
  input: ticket,
  variables: {},
  timeout: null,
  body: {
    kind: 'fork',
    compete: true,
    branches: [
      { state: 'running', task: asking },
      { state: 'running', task: waiting },
      { state: 'failed', error: { type: 'runtime', status: 500, instance: '/do/1/fork/branches/2' }, order: 0 },
    ],
  },
};

const running: RunState = {
  ...newRun,
  executionId,
  status: 'running',
  workflow: { document, input: ticket },
  attributes: { owner: 'tests' },
  limits: { mostDurationMs: 2_592_000_000, longestCallMs: 600_000 },
  startedAt: at - 60_000,
  lastInputAt: at - 60_000,
  inputs: 3,
  random: { seed: 42, draws: 1 },
  runs: { '/do/1': 1, [openCall.reference]: 1, [waiting.reference]: 1 },
  timers: {
    next: 3,
    armed: {
      [armedTimer]: { purpose: 'wait', reference: waiting.reference, armedAt: at - 60_000, dueAt: at + 60_000 },
      [`${executionId}/timers/2`]: {
        purpose: 'timeout',
        reference: asking.reference,
        armedAt: at - 60_000,
        dueAt: at + 600_000,
      },
    },
  },
  calls: { [callKeyText(openCall)]: openCall },
  inbox: {
    waiting: [{ event: { id: 'event-2', type: 'com.acme.approval', data: { approved: true } }, bytes: 80 }],
    waitingBytes: 80,
    receivedIds: ['event-1', 'event-2'],
    received: 2,
    receivedBytes: 160,
    overflow: null,
  },
  heldBytes: 0,
  historyBytes: 9000,
  machine: {
    values: {
      0: { value: { seen: 1 }, bytes: 10 },
      [ticket]: { value: { ticket: 7 }, bytes: 12 },
      [approval]: { value: 1, bytes: 1 },
    },
    nextValue: 3,
    context: 0,
    root: {
      reference: '/',
      run: 1,
      startedAt: at - 60_000,
      context: 0,
      rawInput: ticket,
      input: ticket,
      variables: {},
      timeout: null,
      body: {
        kind: 'list',
        list: {
          pointer: '/do',
          position: 1,
          data: ticket,
          variables: {},
          current: { kind: 'running', task: forking },
        },
      },
    },
  },
};

export const runningState: RunState = { ...running, heldBytes: heldBytesOf(running) };

export const started: Started = {
  kind: 'started',
  executionId,
  at,
  document,
  input: { ticket: 7 },
  limits: { mostDurationMs: 2_592_000_000, longestCallMs: 600_000 },
  attributes: { owner: 'tests' },
  seed: 42,
};
