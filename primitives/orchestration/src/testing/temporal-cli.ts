import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EphemeralServerExecutable } from '@temporalio/testing';

export const temporalCliVersion = 'v1.9.1';

const pinnedBinaryNeverChanges = '10 years';

const downloadDir = tmpdir();

export const temporalCli: EphemeralServerExecutable = {
  type: 'cached-download',
  version: temporalCliVersion,
  downloadDir,
  ttl: pinnedBinaryNeverChanges,
};

export function cachedTemporalCli(): string {
  return join(downloadDir, `temporal-${temporalCliVersion}`);
}
