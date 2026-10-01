import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { Effect, Exit, Scope } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordHistory } from '../../replay-corpus.ts';
import { connectOrchestration } from '../primitive/orchestration-client.ts';
import { runFor, settingsFor, temporalHarness } from '../testing/temporal.ts';
import { workflow } from '../testing/workflows.ts';

const taskQueue = 'worker-restart';

const childWorker = fileURLToPath(new URL('../../temporal-test-worker.ts', import.meta.url));

const executionId = '0199a3c4-7d2e-7c1a-9b3f-222222222221';

const workflowId = `acme/alpha/test-flow/${executionId}`;

const document = workflow(`
do:
  - first: { set: { step: first } }
  - pause: { wait: PT2S }
  - last: { set: { step: '\${ .step + ", then last" }' } }
`);

type HistoryText = () => Promise<string>;

async function untilTimerStarted(historyText: HistoryText): Promise<void> {
  if ((await historyText()).includes('timerStartedEventAttributes')) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });
  return untilTimerStarted(historyText);
}

async function startedOnAWorkerThatIsKilled(historyText: HistoryText): Promise<void> {
  const settings = settingsFor(taskQueue);
  const child = spawn(process.execPath, [childWorker], {
    env: { ...process.env, TEMPORAL_ADDRESS: settings.address, TEMPORAL_TASK_QUEUE: taskQueue },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await once(child.stdout, 'data');
  const scope = Effect.runSync(Scope.make());
  const orchestration = await Effect.runPromise(connectOrchestration(settings).pipe(Scope.provide(scope)));
  await Effect.runPromise(orchestration.start(runFor(document, executionId)));
  await untilTimerStarted(historyText);
  child.kill('SIGKILL');
  await once(child, 'exit');
  await Effect.runPromise(Scope.close(scope, Exit.void));
}

function workerIdentitiesIn(history: string): ReadonlySet<string> {
  const identities = new Set<string>();
  const completions = /"workflowTaskCompletedEventAttributes":\{[^}]*?"identity":"(?<identity>[^"]+)"/gu;
  for (const completion of history.matchAll(completions)) {
    identities.add(completion.groups?.['identity'] ?? '');
  }
  return identities;
}

describe('a worker killed while it runs a workflow', () => {
  it('leaves the workflow to a new worker, which replays it and finishes it', async () => {
    const observer = await temporalHarness(`${taskQueue}-observer`);
    const handle = observer.temporal.workflow.getHandle(workflowId);

    const historyText = async (): Promise<string> => JSON.stringify(await handle.fetchHistory());
    await startedOnAWorkerThatIsKilled(historyText);
    const replacement = await temporalHarness(taskQueue);
    const output: unknown = await handle.result();
    const history = await historyText();
    await recordHistory('worker-restart', () => handle.fetchHistory());
    await replacement.close();
    await observer.close();

    expect(output).toEqual({ step: 'first, then last' });
    expect(workerIdentitiesIn(history).size).toBe(2);
    expect(replacement.settled()).toEqual([
      {
        address: { org: 'acme', brain: 'alpha', id: executionId },
        settlement: { status: 'succeeded', output, record: {} },
      },
    ]);
  }, 60_000);
});
