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
            exclude: [
              'src/interpreter/holding.test.ts',
              'src/interpreter/retained-size.test.ts',
              'src/interpreter/task-bodies.test.ts',
              'src/interpreter/workflow-run.test.ts',
            ],
            env: { ORCHESTRATION_RUNTIME: 'machine' },
          },
        },
      ],
    },
  }),
);
