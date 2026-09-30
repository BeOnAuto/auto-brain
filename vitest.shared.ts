import { defineConfig } from 'vitest/config';

export const sharedConfig = defineConfig({
  test: {
    experimental: {
      viteModuleRunner: false,
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json-summary'],
      autoAttachSubprocess: true,
      thresholds: { 100: true, perFile: true },
    },
  },
});
