import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { newRun, stateFormats, stateInCurrentFormat } from '../index.ts';
import { at, executionId } from '../testing/runs.ts';

const toJson = Schema.decodeUnknownSync(Schema.Json);

const frameOfFormatOne = {
  reference: '/do/0/race',
  run: 1,
  rawInput: 0,
  input: 0,
  variables: {},
  timeout: null,
  body: {
    kind: 'fork',
    compete: true,
    branches: [
      { state: 'failed', error: { type: 'runtime', status: 500, instance: '/a' } },
      {
        state: 'running',
        task: {
          reference: '/do/0/race/fork/branches/1/pause',
          run: 1,
          rawInput: 0,
          input: 0,
          variables: {},
          timeout: null,
          body: { kind: 'wait', timer: `${executionId}/timers/1` },
        },
      },
      { state: 'failed', error: { type: 'runtime', status: 500, instance: '/c' } },
    ],
  },
};

const stateOfFormatOne = toJson({
  ...newRun,
  executionId,
  status: 'running',
  lastInputAt: at,
  timers: {
    next: 2,
    armed: { [`${executionId}/timers/1`]: { purpose: 'wait', reference: '/do/0/race', dueAt: at + 5000 } },
  },
  machine: { ...newRun.machine, root: frameOfFormatOne },
});

describe('a state of format 1', () => {
  it('is upcast to the current format: frames start at the last input with the context then, armed timers armed then, and failures ordered as their branches', () => {
    const upcast = stateInCurrentFormat(1, stateOfFormatOne);

    expect(upcast.timers.armed).toEqual({
      [`${executionId}/timers/1`]: { purpose: 'wait', reference: '/do/0/race', armedAt: at, dueAt: at + 5000 },
    });
    expect(upcast.machine.root).toMatchObject({
      startedAt: at,
      context: 0,
      body: {
        branches: [
          { state: 'failed', order: 0 },
          { state: 'running', task: { startedAt: at, context: 0 } },
          { state: 'failed', order: 2 },
        ],
      },
    });
  });

  it('is read strictly as format 1, so a state of another format is refused before it is upcast', () => {
    const [formatOne] = stateFormats.older;

    expect(formatOne?.format).toBe(1);
    expect(() => stateInCurrentFormat(1, toJson({ ...newRun, executionId, extra: true }))).toThrow(/extra/u);
  });

  it('does not load when a list in it stands between its tasks, which format 2 has no way to hold and no runtime wrote', () => {
    const between = { pointer: '/do', position: 1, data: 0, variables: {}, current: null };
    const root = { ...frameOfFormatOne, body: { kind: 'list', list: between } };
    const state = toJson({ ...newRun, executionId, status: 'running', machine: { ...newRun.machine, root } });

    expect(() => stateInCurrentFormat(1, state)).toThrow(/current/u);
  });
});
