import { workflowMachine } from '../src/decider/workflow-machine.ts';
import type { RunInput } from '../src/machine/run-input.ts';
import { newRun, type RunState } from '../src/machine/run-state.ts';
import { snapshotChunks, snapshotOf } from '../src/run-log/snapshot.ts';
import { startedOf, testCancel, testMachine } from '../src/testing/driver-inputs.ts';
import { memoryDriver } from '../src/testing/memory-driver.ts';
import { workflow } from '../src/testing/workflows.ts';
import { executionId, looping, medianMillisecondsOf, nextTick, startedAt, textBytesOf } from './common.ts';

const calling = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const listening = workflow('do:\n  - await: { listen: { to: { one: { with: { type: approved } } } } }');

const holdingAMegabyte = workflow(`
do:
  - hold: { set: '\${ { text: ("x" * 1000000) } }' }
  - pause: { wait: PT1H }
`);

function waitingState(document: ReturnType<typeof workflow>): RunState {
  const driver = memoryDriver({ respond: () => 'never' });
  driver.start({ executionId, document });
  return driver.state(executionId);
}

function answerTo(state: RunState): RunInput {
  const [key = { executionId, reference: '/do/0/ask', run: 1 }] = Object.values(state.calls);
  return { kind: 'call_answered', executionId, at: state.lastInputAt, key, result: { status: 'succeeded', output: 1 } };
}

function decideMicroseconds(input: RunInput, state: RunState): string {
  const machine = workflowMachine(testMachine);
  return (
    medianMillisecondsOf(1001, () => {
      machine.decide(input, state);
    }) * 1000
  ).toFixed(0);
}

export function decideMeasured(): readonly string[] {
  const ticking = waitingState(looping(40_000));
  const asking = waitingState(calling);
  const awaiting = waitingState(listening);
  const event = { id: 'e1', type: 'approved', data: 'yes' };
  const medians = [
    `started ${decideMicroseconds(startedOf({ executionId, document: looping(40_000) }, startedAt), newRun)} µs`,
    `timer ${decideMicroseconds(nextTick(ticking), ticking)} µs`,
    `answer ${decideMicroseconds(answerTo(asking), asking)} µs`,
    `event ${decideMicroseconds({ kind: 'event_received', executionId, at: awaiting.lastInputAt, event }, awaiting)} µs`,
    `cancel ${decideMicroseconds({ kind: 'cancel_requested', executionId, at: ticking.lastInputAt, cancel: testCancel }, ticking)} µs`,
  ];
  return [`decide, at the median: ${medians.join(', ')}`];
}

export function snapshotMeasured(): readonly string[] {
  const holding = waitingState(holdingAMegabyte);
  const bytes = snapshotChunks(snapshotOf(holding, 1)).reduce((sum, chunk) => sum + textBytesOf(chunk), 0);
  return [`a snapshot of a run holding 1,000,000 characters across a wait: ${bytes} bytes`];
}
