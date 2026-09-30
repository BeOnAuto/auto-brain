import { globSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import type { UserConfig } from '@commitlint/types';

const workspaceScopes = globSync('packages/*/package.json', { cwd: import.meta.dirname }).map((manifest) =>
  basename(dirname(manifest)),
);

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', [...workspaceScopes, 'global', 'deps', 'ci', 'release']],
  },
} satisfies UserConfig;
