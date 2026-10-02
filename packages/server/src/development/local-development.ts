import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { startChild } from './children.ts';
import type { DevelopmentSetup, LocalTemporal } from './development-run.ts';
import { obtainTemporalCli, pinnedTemporalCli } from './temporal-cli.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

const localTemporal: LocalTemporal = { port: 7233, uiPort: 8233, stateFile: '.data/temporal.db' };

function workspaceSources(root: string): readonly string[] {
  return ['packages', 'primitives']
    .flatMap((group) => readdirSync(join(root, group)).map((name) => join(root, group, name, 'src')))
    .filter((directory) => existsSync(directory));
}

export function localDevelopment(args: readonly string[]): DevelopmentSetup {
  const { values } = parseArgs({ args: [...args], options: { lean: { type: 'boolean', default: false } } });
  return {
    envFiles: [join(repository, 'packages', 'server', 'dev.env'), join(repository, '.env')],
    sourceDirectories: workspaceSources(repository),
    serverEntry: join(repository, 'packages', 'server', 'src', 'main.ts'),
    temporal: values.lean ? undefined : localTemporal,
    obtainCli: (announce) => obtainTemporalCli(announce, pinnedTemporalCli),
    startChild,
  };
}
