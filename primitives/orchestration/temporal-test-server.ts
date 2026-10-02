import { once } from 'node:events';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { TestProject } from 'vitest/node';

import { temporalCli } from './src/testing/temporal-cli.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    temporalAddress: string;
  }
}

const longestTeardown = 10_000;

export default async function startTemporalTestServer(project: {
  readonly provide: TestProject['provide'];
}): Promise<() => Promise<void>> {
  const environment = await TestWorkflowEnvironment.createLocal({
    server: { executable: temporalCli, ip: '127.0.0.1', log: { format: 'pretty', level: 'error' } },
  });
  project.provide('temporalAddress', environment.address);
  return async () => {
    await Promise.race([environment.teardown(), once(AbortSignal.timeout(longestTeardown), 'abort')]);
  };
}
