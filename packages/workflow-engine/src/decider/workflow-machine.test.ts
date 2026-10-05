import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { newRun, RunStateSchema } from '../machine/run-state.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import { startedOf, testMachine } from '../testing/driver-inputs.ts';
import { drivenExecutionId as executionId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { workflowMachine } from './workflow-machine.ts';

const calling = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const decodeState = Schema.decodeUnknownSync(RunStateSchema);

const corpusState = decodeState(
  Reflect.get(
    JSON.parse(readFileSync(fileURLToPath(new URL('../../corpus/format-2.json', import.meta.url)), 'utf8')),
    'state',
  ),
);

describe('the workflow machine', () => {
  it('decides the same events for the same state and input', () => {
    const machine = workflowMachine(testMachine);
    const input = startedOf({ executionId, document: calling }, 1_790_845_200_000);

    expect(machine.decide(input, newRun)).toEqual(machine.decide(input, newRun));
  });

  it('dies, rather than ending the run, when the functions it was given break', () => {
    const machine = workflowMachine({
      ...testMachine,
      functions: {
        ...testMachine.functions,
        describe: () => {
          throw new Error('The description broke');
        },
      },
    });

    expect(() => machine.decide(startedOf({ executionId, document: calling }, 0), newRun)).toThrow(
      'The description broke',
    );
  });

  it('applies an input to a run of the format corpus, which has no frame, without stepping a task', () => {
    const machine = workflowMachine(testMachine);
    const input = {
      kind: 'event_received',
      executionId: corpusState.executionId,
      at: corpusState.lastInputAt + 1,
      event: { id: 'corpus-event', type: 'com.acme.tick' },
    } as const;

    const events = Result.getOrThrow(machine.decide(input, corpusState));
    const after = events.reduce((state, event) => evolveRun(state, event), corpusState);

    expect(events.map(({ steps }) => steps)).toEqual([[]]);
    expect(after.inbox.receivedIds).toContain('corpus-event');
    expect(after.status).toBe('running');
  });
});
