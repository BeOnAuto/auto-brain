import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cachedTemporalCli } from '@beonauto/orchestration/testing/temporal-cli';
import { describe, expect, it } from 'vitest';

import { localDevelopment } from './local-development.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

describe('the local development setup', () => {
  it('runs src/main.ts with dev.env, then the repository .env, and a Temporal dev server on 7233 with its web UI on 8233', () => {
    expect(localDevelopment([])).toMatchObject({
      envFiles: [join(repository, 'packages/server/dev.env'), join(repository, '.env')],
      serverEntry: join(repository, 'packages/server/src/main.ts'),
      temporal: { port: 7233, uiPort: 8233, stateFile: '.data/temporal.db' },
    });
  });

  it('watches the source directory of every workspace package', () => {
    const watched = localDevelopment([]).sourceDirectories;

    const missing = ['packages/server', 'packages/api', 'primitives/orchestration', 'primitives/inference']
      .map((workspace) => join(repository, workspace, 'src'))
      .filter((directory) => !watched.includes(directory));

    expect(missing).toEqual([]);
  });

  it('starts no Temporal with --lean', () => {
    expect(localDevelopment(['--lean']).temporal).toBeUndefined();
  });

  it('refuses arguments it does not know', () => {
    expect(() => localDevelopment(['--fast'])).toThrow("Unknown option '--fast'");
  });

  it('obtains the pinned Temporal CLI', async () => {
    const said: string[] = [];

    const cli = await localDevelopment([]).obtainCli((message) => {
      said.push(message);
    });

    expect({ cli, said }).toEqual({ cli: cachedTemporalCli(), said: [] });
  });
});
