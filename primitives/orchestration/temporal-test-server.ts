import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    temporalAddress: string;
  }
}

export default async function startTemporalTestServer(project: {
  readonly provide: TestProject['provide'];
}): Promise<() => Promise<void>> {
  const environment = await TestWorkflowEnvironment.createLocal({
    server: { ip: '127.0.0.1', log: { format: 'pretty', level: 'error' } },
  });
  project.provide('temporalAddress', environment.address);
  return () => environment.teardown();
}
