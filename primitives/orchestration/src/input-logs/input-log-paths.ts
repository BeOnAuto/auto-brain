import type { CallResult } from '@beonauto/operations';
import type { JsonObject, RunOutcome } from '@beonauto/workflow-engine';
import { memoryDriver, type MemoryDriver, type Responder } from '@beonauto/workflow-engine/testing';

import { isArgumentsProblem, specArgumentsOf, type SpecArguments } from '../document/spec-arguments.ts';
import { orchestrationMachine } from '../runs/orchestration-machine.ts';
import { workflow } from '../testing/workflows.ts';
import type { InputLog } from './input-log-corpus.ts';

type Answer = (spec: SpecArguments, run: number) => CallResult;

export interface InputLogPath {
  readonly name: string;
  readonly source: string;
  readonly ends: RunOutcome;
  readonly input?: JsonObject;
  readonly answer?: Answer;
  readonly meanwhile?: (driver: MemoryDriver, executionId: string) => void;
}

function summarizing({ name, input }: SpecArguments): CallResult {
  return { status: 'succeeded', output: { summary: `${name} of ${JSON.stringify(input)}` } };
}

function flakyTwice(_spec: SpecArguments, run: number): CallResult {
  return run < 3
    ? { status: 'rejected', reason: 'unavailable', detail: `busy on call ${run}` }
    : { status: 'succeeded', output: { calls: run } };
}

function delivering(...events: readonly { readonly id: string; readonly type: string; readonly data: string }[]) {
  return (driver: MemoryDriver, executionId: string): void => {
    for (const event of events) {
      driver.deliver(executionId, event);
    }
  };
}

function cancellingAfter(milliseconds: number) {
  return (driver: MemoryDriver, executionId: string): void => {
    driver.at(milliseconds, () => {
      driver.cancel(executionId);
    });
  };
}

export const inputLogPaths: readonly InputLogPath[] = [
  {
    name: 'cancelled',
    source: 'do:\n  - pause: { wait: PT1H }',
    ends: { kind: 'cancelled' },
    meanwhile: cancellingAfter(10),
  },
  {
    name: 'catch-do-recovery',
    source: `
do:
  - guarded:
      try:
        - fail: { raise: { error: { type: https://example.com/errors/busy, status: 503 } } }
      catch:
        errors: { with: { status: 503 } }
        do:
          - recover: { set: { recovered: true } }
`,
    ends: { kind: 'completed', output: { recovered: true } },
  },
  {
    name: 'execute-spec',
    source: `
do:
  - summarize:
      call: execute_spec
      with: { primitive: inference, name: summarize, input: { text: '\${ .text }' } }
  - answer:
      set: { summary: '\${ .summary }', runtime: '\${ $runtime.name }' }
`,
    input: { text: 'hello' },
    ends: { kind: 'completed', output: { summary: 'summarize of {"text":"hello"}', runtime: 'auto-brain' } },
    answer: summarizing,
  },
  {
    name: 'for-with-wait',
    source: `
do:
  - each:
      for: { in: '\${ [1, 2] }' }
      do:
        - pause: { wait: { milliseconds: 200 } }
        - add: { set: { total: '\${ (.total // 0) + $item }' } }
`,
    ends: { kind: 'completed', output: { total: 3 } },
  },
  {
    name: 'fork-compete',
    source: `
do:
  - race:
      fork:
        compete: true
        branches:
          - slow: { do: [{ pause: { wait: PT5S } }, { done: { set: { won: slow } } }] }
          - quick: { set: { won: quick } }
`,
    ends: { kind: 'completed', output: { won: 'quick' } },
  },
  {
    name: 'listen-signals',
    source: 'do:\n  - await: { listen: { to: { one: { with: { type: approved } } } } }',
    ends: { kind: 'completed', output: ['yes'] },
    meanwhile: delivering({ id: 'e1', type: 'declined', data: 'no' }, { id: 'e2', type: 'approved', data: 'yes' }),
  },
  {
    name: 'parallel-fork',
    source: `
do:
  - both:
      fork:
        branches:
          - left: { call: execute_spec, with: { primitive: inference, name: left } }
          - right: { call: execute_spec, with: { primitive: inference, name: right } }
`,
    ends: { kind: 'completed', output: [{ summary: 'left of {}' }, { summary: 'right of {}' }] },
    answer: summarizing,
  },
  {
    name: 'retry-with-backoff',
    source: `
do:
  - guarded:
      try:
        - fetch: { call: execute_spec, with: { primitive: inference, name: flaky, input: { key: backoff } } }
      catch:
        errors: { with: { status: 503 } }
        retry: { delay: { milliseconds: 500 }, backoff: { exponential: {} }, limit: { attempt: { count: 3 } } }
`,
    ends: { kind: 'completed', output: { calls: 3 } },
    answer: flakyTwice,
  },
  {
    name: 'switch',
    source: `
do:
  - decide:
      switch:
        - big: { when: '\${ false }', then: large }
        - otherwise: { then: small }
  - large: { set: { size: large }, then: end }
  - small: { set: { size: small } }
`,
    ends: { kind: 'completed', output: { size: 'small' } },
  },
  {
    name: 'temporal-global',
    source: `
do:
  - clock:
      set:
        startedAt: '\${ $workflow.startedAt.iso8601 }'
        taskStartedAt: '\${ $task.startedAt.epoch.milliseconds }'
        now: '\${ now }'
`,
    ends: {
      kind: 'completed',
      output: { startedAt: '2026-10-01T09:00:00.000Z', taskStartedAt: 1_790_845_200_000, now: 1_790_845_200 },
    },
  },
  {
    name: 'then-jump-back',
    source: `
do:
  - count: { set: { n: '\${ (.n // 0) + 1 }' } }
  - again: { if: '\${ .n < 3 }', wait: { milliseconds: 100 }, then: count }
`,
    ends: { kind: 'completed', output: { n: 3 } },
  },
  {
    name: 'timeout-fires',
    source: `
do:
  - guarded:
      try:
        - slow: { wait: PT5S, timeout: { after: { milliseconds: 300 } } }
      catch:
        errors: { with: { status: 408 } }
        do:
          - late: { set: { timedOut: true } }
`,
    ends: { kind: 'completed', output: { timedOut: true } },
  },
  {
    name: 'timer',
    source: 'do:\n  - pause: { wait: { milliseconds: 1200 } }',
    input: { waited: true },
    ends: { kind: 'completed', output: { waited: true } },
  },
  {
    name: 'uncaught-error',
    source: 'do:\n  - reject: { raise: { error: { type: https://example.com/no, status: 422, title: No } } }',
    ends: {
      kind: 'raised',
      error: { type: 'https://example.com/no', status: 422, title: 'No', instance: '/do/0/reject' },
    },
  },
  {
    name: 'worker-restart',
    source: `
do:
  - first: { set: { step: first } }
  - pause: { wait: PT2S }
  - last: { set: { step: '\${ .step + ", then last" }' } }
`,
    ends: { kind: 'completed', output: { step: 'first, then last' } },
  },
];

export function responderOf(answer: Answer): Responder {
  return (call) => {
    const spec = specArgumentsOf(call.arguments);
    if (isArgumentsProblem(spec)) {
      return { result: { status: 'rejected', reason: 'invalid_arguments', detail: spec.title } };
    }
    return { after: 50, result: answer(spec, call.key.run) };
  };
}

export function inputLogOf(name: string): InputLog {
  const number = inputLogPaths.findIndex((path) => path.name === name);
  const path = inputLogPaths[number];
  if (path === undefined) {
    throw new Error(`No input log path is named ${name}`);
  }
  const executionId = `0199a3c4-7d2e-7c1a-9b3f-${String(300 + number).padStart(12, '0')}`;
  const driver = memoryDriver({ machine: orchestrationMachine, respond: responderOf(path.answer ?? summarizing) });
  driver.start({ executionId, document: workflow(path.source), input: path.input ?? {} });
  path.meanwhile?.(driver, executionId);
  driver.runUntilEnded(executionId);
  return {
    name: path.name,
    inputs: driver.inputsOf(executionId),
    events: driver.ports.runStore.events(executionId).map(({ event }) => event),
  };
}
