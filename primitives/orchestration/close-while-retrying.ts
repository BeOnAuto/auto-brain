import { setTimeout } from 'node:timers/promises';

import { Effect, Exit, Scope } from 'effect';

import { connectOrchestration } from './src/primitive/orchestration-client.ts';
import { runFor, workflow } from './src/testing/workflows.ts';

const settings = {
  address: '127.0.0.1:1',
  namespace: 'default',
  taskQueue: 'nowhere',
  tls: false,
  mostDuration: 2_592_000_000,
  nestedExecutions: 1,
};

const scope = Effect.runSync(Scope.make());
const client = await Effect.runPromise(
  connectOrchestration(settings, { requestTimeout: 300 }).pipe(Scope.provide(scope)),
);
const failure = await Effect.runPromise(Effect.flip(client.start(runFor(workflow('do: []'), 'nowhere'))));
await Effect.runPromise(Scope.close(scope, Exit.void));
await setTimeout(6000);
process.stdout.write(`${failure.detail}\n`);
