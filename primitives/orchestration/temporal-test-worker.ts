import { DefaultLogger, Runtime } from '@temporalio/worker';
import { Effect } from 'effect';

import { runOrchestrationWorker } from './src/worker/orchestration-worker.ts';

Runtime.install({ logger: new DefaultLogger('WARN') });

const settings = {
  address: process.env['TEMPORAL_ADDRESS'] ?? '',
  namespace: 'default',
  taskQueue: process.env['TEMPORAL_TASK_QUEUE'] ?? '',
  tls: false,
};

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      yield* runOrchestrationWorker({
        settings,
        executeSpec: () => Effect.die(new Error('This worker executes no specs')),
        settle: () => Effect.die(new Error('This worker settles no executions')),
      });
      process.stdout.write('ready\n');
      return yield* Effect.never;
    }),
  ),
);
