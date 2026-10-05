import { evolveRun, newRun, workflowMachine, type RunEvent, type RunState } from '@beonauto/workflow-engine';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedInputLogs, recordInputLog, type InputLog } from '../../input-log-corpus.ts';
import { inputLogOf, inputLogPaths, orchestrationMachine } from '../../input-log-paths.ts';
import { recordedHistories } from '../../replay-corpus.ts';

const machine = workflowMachine(orchestrationMachine);

function replayed({ inputs }: InputLog): readonly RunEvent[] {
  const events: RunEvent[] = [];
  let state = newRun;
  for (const input of inputs) {
    for (const event of Result.getOrThrow(machine.decide(input, state))) {
      state = evolveRun(state, event);
      events.push(event);
    }
  }
  return events;
}

const committed = new Map(recordedInputLogs().map((log) => [log.name, log]));

const endings = new Map(inputLogPaths.map(({ name, ends }) => [name, ends]));

function endedFrom(events: readonly RunEvent[]): RunState {
  return events.reduce((state, event) => evolveRun(state, event), newRun);
}

describe('the recorded input logs of workflows', () => {
  it.each(recordedInputLogs())('$name replays through the machine to the events it recorded', (log) => {
    expect(replayed(log)).toEqual(log.events);
  });

  it.each(inputLogPaths.map(({ name }) => name))('%s runs today as it was recorded', (name) => {
    const log = inputLogOf(name);
    recordInputLog(log);

    expect(log).toEqual(committed.get(name));
  });

  it.each(recordedInputLogs())('$name ends as it ended on Temporal', ({ name, events }) => {
    expect(endedFrom(events).outcome).toEqual(endings.get(name));
  });

  it('cover every path of the replay corpus of the Temporal runtime', () => {
    expect([...committed.keys()]).toEqual(recordedHistories().map(({ workflowId }) => workflowId));
  });
});
