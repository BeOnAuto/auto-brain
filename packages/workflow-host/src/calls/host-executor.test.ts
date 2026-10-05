import type { CallResult } from '@beonauto/operations';
import { callKeyText, type CallKey, type StartCall } from '@beonauto/workflow-engine';
import { Deferred, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { faultyDatabase, type FaultyDatabase } from '../testing/faulty-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { runId } from '../testing/probe-subjects.ts';
import { hostExecutor, type Deliver, type HostExecutor } from './host-executor.ts';

const run = { executionId: runId, attributes: { org: 'acme' } };

const call: StartCall = {
  kind: 'start_call',
  key: { executionId: runId, reference: '/do/0/notify', run: 1 },
  function: 'notify',
  arguments: { to: 'ada' },
  longestMs: 60_000,
};

const sent: CallResult = { status: 'succeeded', output: 'sent' };

interface Executing {
  readonly database: FaultyDatabase;
  readonly executorOn: (deliver?: Deliver) => HostExecutor;
  readonly performed: () => number;
  readonly answered: () => readonly string[];
  readonly troubles: () => readonly string[];
}

type Answer = (database: FaultyDatabase) => Effect.Effect<CallResult>;

const answeredSent: Answer = () => Effect.succeed(sent);

const neverAnswered: Answer = () => Effect.never;

async function executing(answer: Answer = answeredSent): Promise<Executing> {
  const database = faultyDatabase(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
  const counts = { performed: 0 };
  const answered: string[] = [];
  const troubles: string[] = [];
  const deliverAnswer: Deliver = (key: CallKey) =>
    Effect.sync(() => {
      answered.push(callKeyText(key));
    });
  return {
    database,
    executorOn: (deliver = deliverAnswer) =>
      hostExecutor({
        database,
        perform: () =>
          Effect.suspend(() => {
            counts.performed += 1;
            return answer(database);
          }),
        deliver,
        trouble: (what) =>
          Effect.sync(() => {
            troubles.push(what);
          }),
        mostAtOnce: 2,
      }),
    performed: () => counts.performed,
    answered: () => answered,
    troubles: () => troubles,
  };
}

describe('the executor of the host', () => {
  it('starts again, when it resumes, a call that a host that died was running', async () => {
    const calls = await executing(neverAnswered);
    const died = calls.executorOn();
    await Effect.runPromise(died.executor.start(call, run));
    await Effect.runPromise(died.stop());

    const resumed = calls.executorOn();
    const restarted = await Effect.runPromise(resumed.resume());
    const resumedAgain = await Effect.runPromise(resumed.resume());

    expect([restarted, resumedAgain, calls.performed()]).toEqual([1, 0, 2]);
    await Effect.runPromise(resumed.stop());
  });

  it('stops the calls it runs without reporting them as troubles', async () => {
    const calls = await executing(neverAnswered);
    const executor = calls.executorOn();
    await Effect.runPromise(executor.executor.start(call, run));
    await Effect.runPromise(executor.executor.cancel({ kind: 'cancel_call', key: call.key }, run));
    await Effect.runPromise(executor.executor.start({ ...call, key: { ...call.key, run: 2 } }, run));

    await Effect.runPromise(executor.stop());

    expect(calls.troubles()).toEqual([]);
  });
});

describe('the executor of the host, after a host died', () => {
  it('cancels a call that a host that died was running, interrupting nothing', async () => {
    const calls = await executing(neverAnswered);
    const died = calls.executorOn();
    await Effect.runPromise(died.executor.start(call, run));
    await Effect.runPromise(died.stop());

    const cancelled = await Effect.runPromise(
      calls.executorOn().executor.cancel({ kind: 'cancel_call', key: call.key }, run),
    );

    expect(cancelled).toBe('cancelled');
  });
});

describe('the executor of the host, answering', () => {
  it('gives no answer of a call that another host cancelled while it ran', async () => {
    const finishing = Deferred.makeUnsafe<CallResult>();
    const calls = await executing(() => Deferred.await(finishing));
    const running = calls.executorOn();
    await Effect.runPromise(running.executor.start(call, run));
    const cancel = { kind: 'cancel_call', key: call.key } as const;

    const cancelled = await Effect.runPromise(calls.executorOn().executor.cancel(cancel, run));
    const cancelledAgain = await Effect.runPromise(calls.executorOn().executor.cancel(cancel, run));
    await Effect.runPromise(Deferred.succeed(finishing, sent));
    await Effect.runPromise(running.idle());

    expect([cancelled, cancelledAgain, calls.answered()]).toEqual(['cancelled', 'tombstoned', []]);
  });

  it('keeps an answer it could not give to its run, and gives it when it next resumes', async () => {
    const calls = await executing();
    const refusing = calls.executorOn(() => Effect.fail(new Error('The run is busy')));
    await Effect.runPromise(refusing.executor.start(call, run));
    await Effect.runPromise(refusing.idle());

    const giving = calls.executorOn();
    const resumed = await Effect.runPromise(giving.resume());
    await Effect.runPromise(giving.idle());

    expect([resumed, calls.performed(), calls.answered()]).toEqual([1, 1, [callKeyText(call.key)]]);
    expect(calls.troubles()).toEqual(['An answer of a call could not be given to its run']);
    expect(await Effect.runPromise(giving.resume())).toBe(0);
  });
});

describe('the executor of the host, failing', () => {
  it('reports an answer it could not record, and gives none', async () => {
    const calls = await executing((database) =>
      Effect.sync(() => {
        database.failing(true);
        return sent;
      }),
    );
    const executor = calls.executorOn();

    await Effect.runPromise(executor.executor.start(call, run));
    await Effect.runPromise(executor.idle());

    expect([calls.answered(), calls.troubles()]).toEqual([[], ['A call could not record its answer']]);
  });

  it('fails a start or a cancel it cannot record, to be dispatched again', async () => {
    const calls = await executing();
    const executor = calls.executorOn();
    calls.database.failing(true);

    const start = await Effect.runPromise(Effect.flip(executor.executor.start(call, run)));
    const cancel = await Effect.runPromise(
      Effect.flip(executor.executor.cancel({ kind: 'cancel_call', key: call.key }, run)),
    );

    expect([start.output, cancel.output]).toEqual(['start_call', 'cancel_call']);
    expect(start.detail).toBe('The database was told to fail');
  });
});
