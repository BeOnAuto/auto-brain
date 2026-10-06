import { setTimeout } from 'node:timers/promises';

import type { CallResult } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';

const notifying = workflow('do:\n  - notify: { call: notify, with: { to: ada } }');

describe('the host told to stop just after it admitted a start', () => {
  it('lets the start finish, then stops the call it began, so nothing outlives the stop', async () => {
    const answers = { begun: 0, finished: 0 };
    const answeredLater: Effect.Effect<CallResult> = Effect.sync(() => {
      answers.begun += 1;
    }).pipe(
      Effect.andThen(Effect.sleep(200)),
      Effect.andThen(
        Effect.sync((): CallResult => {
          answers.finished += 1;
          return { status: 'succeeded', output: 'sent' };
        }),
      ),
    );
    const hosted = await hostedOn(
      { store: 'sqlite', file: aSQLiteFile() },
      { answer: () => answeredLater, sweepEveryMs: 3_600_000 },
    );

    const starting = Effect.runPromise(
      hosted.host.start(runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'), startOf(notifying)),
    );
    const stopping = hosted.host.stop();
    const started = await starting;
    await stopping;
    await setTimeout(300);

    expect(started).toBe('started');
    expect(answers).toEqual({ begun: 1, finished: 0 });
    expect(hosted.troubles()).toEqual([]);
  }, 30_000);
});
