import { makeAppRuntime } from '@beonauto/api';
import { Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { applicationLayer } from './composition-root.ts';
import { inRuntime } from './worker-dependencies.ts';

describe('work the worker hands to the runtime of the server', () => {
  it('runs on the services of the runtime, and fails as it fails there', async () => {
    const runtime = await makeAppRuntime(applicationLayer(':memory:'));

    const done = await Effect.runPromise(inRuntime(runtime, Effect.succeed('done')));
    const refused = await Effect.runPromise(Effect.exit(inRuntime(runtime, Effect.fail('refused'))));
    await runtime.dispose();

    expect(done).toBe('done');
    expect(refused).toStrictEqual(Exit.fail('refused'));
  });

  it('dies once the runtime is disposed, so Temporal retries the activity elsewhere', async () => {
    const runtime = await makeAppRuntime(Layer.empty.pipe(Layer.provideMerge(applicationLayer(':memory:'))));
    await runtime.dispose();

    const exit = await Effect.runPromise(Effect.exit(inRuntime(runtime, Effect.succeed('too late'))));

    expect(String(exit)).toContain('The server stopped before the work could be done');
  });
});
