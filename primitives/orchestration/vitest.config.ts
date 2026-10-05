import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedConfig } from '../../vitest.shared.ts';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      projects: [
        { extends: true, test: { name: 'orchestration', globalSetup: ['temporal-test-server.ts'] } },
        {
          extends: true,
          test: {
            name: 'orchestration-on-the-machine',
            include: ['src/interpreter/**/*.test.ts'],
            env: { ORCHESTRATION_RUNTIME: 'machine' },
          },
        },
      ],
    },
  }),
);
