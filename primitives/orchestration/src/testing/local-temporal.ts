import { once } from 'node:events';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { onTestFinished } from 'vitest';

import { temporalCli } from './temporal-cli.ts';

export async function temporalOn(port: number): Promise<() => Promise<void>> {
  const environment = await TestWorkflowEnvironment.createLocal({
    server: { executable: temporalCli, ip: '127.0.0.1', port, log: { format: 'pretty', level: 'error' } },
  });
  let stopping: Promise<unknown> | undefined;
  const stop = async (): Promise<void> => {
    stopping ??= Promise.race([environment.teardown(), once(AbortSignal.timeout(10_000), 'abort')]);
    await stopping;
  };
  onTestFinished(stop, 20_000);
  return stop;
}
