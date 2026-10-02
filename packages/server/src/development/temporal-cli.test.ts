import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cachedTemporalCli } from '@beonauto/orchestration/testing/temporal-cli';
import { describe, expect, it, onTestFinished } from 'vitest';

import { workflowTestTimeoutMs } from '../testing/workflow-server.ts';
import {
  downloadThroughTheTestingPackage,
  obtainTemporalCli,
  pinnedTemporalCli,
  type TemporalCliSource,
} from './temporal-cli.ts';

interface Obtained {
  readonly cli: string;
  readonly said: readonly string[];
}

function missingCli(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-brain-temporal-cli-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, 'temporal-v1.9.1');
}

async function obtainedFrom(source: TemporalCliSource): Promise<Obtained> {
  const said: string[] = [];
  const cli = await obtainTemporalCli((message) => {
    said.push(message);
  }, source);
  return { cli, said };
}

const downloadNotExpected = (): Promise<void> => Promise.reject(new Error('the cached CLI should have been used'));

describe('obtaining the Temporal CLI', { timeout: workflowTestTimeoutMs }, () => {
  it('uses the pinned CLI the test server already cached, without a word', async () => {
    const obtained = obtainedFrom({ ...pinnedTemporalCli, download: downloadNotExpected });

    await expect(obtained).resolves.toEqual({ cli: cachedTemporalCli(), said: [] });
  });

  it('says it downloads the CLI, once, into the directory it caches it in', async () => {
    const cli = missingCli();

    const obtained = obtainedFrom({
      path: () => cli,
      download: () => {
        writeFileSync(cli, '#!/bin/sh\n', { mode: 0o755 });
        return Promise.resolve();
      },
    });

    await expect(obtained).resolves.toEqual({
      cli,
      said: [`Downloading the Temporal CLI v1.9.1 into ${join(cli, '..')}; this happens once`],
    });
  });

  it('fails when the download leaves no CLI where it was expected', async () => {
    const cli = missingCli();

    const obtained = obtainedFrom({ path: () => cli, download: downloadThroughTheTestingPackage });

    await expect(obtained).rejects.toThrow(`ENOENT: no such file or directory, access '${cli}'`);
  });
});
