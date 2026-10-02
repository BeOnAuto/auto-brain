import { DefaultLogger, Runtime } from '@temporalio/worker';
import { Effect } from 'effect';

import { runOrchestrationWorker } from './src/worker/orchestration-worker.ts';

Runtime.install({ logger: new DefaultLogger('WARN'), shutdownSignals: [] });

const settings = {
  address: process.env['TEMPORAL_ADDRESS'] ?? '',
  namespace: 'default',
  taskQueue: process.env['TEMPORAL_TASK_QUEUE'] ?? '',
  tls: false,
  mostDuration: 2_592_000_000,
};

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      yield* runOrchestrationWorker({
        settings,
        executeSpec: () => Effect.die(new Error('This worker executes no specs')),
        settle: () => Effect.die(new Error('This worker settles no executions')),
        reportUnsettled: ({ executionId, reason }) => {
          process.stderr.write(`${executionId}: ${reason}\n`);
        },
        onFailure: (detail) => {
          process.stderr.write(`${detail}\n`);
        },
      });
      process.stdout.write('ready\n');
      return yield* Effect.never;
    }),
  ),
);
