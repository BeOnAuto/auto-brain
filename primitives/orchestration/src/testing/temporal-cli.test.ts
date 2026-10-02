import { spawnSync } from 'node:child_process';

import { expect, it } from 'vitest';

import { cachedTemporalCli, temporalCliVersion } from './temporal-cli.ts';

it('caches the pinned Temporal CLI that the test server runs where cachedTemporalCli says', () => {
  const { stdout } = spawnSync(cachedTemporalCli(), ['--version'], { encoding: 'utf8' });

  expect(stdout.split(' ').slice(0, 3)).toEqual(['temporal', 'version', temporalCliVersion.replace(/^v/u, '')]);
});
