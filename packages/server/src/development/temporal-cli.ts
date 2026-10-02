import { access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';

import { cachedTemporalCli, temporalCli, temporalCliVersion } from '@beonauto/orchestration/testing/temporal-cli';

export interface TemporalCliSource {
  readonly path: () => string;
  readonly download: () => Promise<void>;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function downloadThroughTheTestingPackage(): Promise<void> {
  const { TestWorkflowEnvironment } = await import('@temporalio/testing');
  const environment = await TestWorkflowEnvironment.createLocal({
    server: { executable: temporalCli, ip: '127.0.0.1', log: { format: 'pretty', level: 'error' } },
  });
  await environment.teardown();
}

export const pinnedTemporalCli: TemporalCliSource = {
  path: cachedTemporalCli,
  download: downloadThroughTheTestingPackage,
};

export async function obtainTemporalCli(
  announce: (message: string) => void,
  { path, download }: TemporalCliSource,
): Promise<string> {
  const cli = path();
  if (await isExecutable(cli)) {
    return cli;
  }
  announce(`Downloading the Temporal CLI ${temporalCliVersion} into ${dirname(cli)}; this happens once`);
  await download();
  await access(cli, constants.X_OK);
  return cli;
}
