import { Runtime } from '@temporalio/worker';
import { describe, expect, it, vi } from 'vitest';

import { installTemporalRuntime, type TemporalLogEntry } from './temporal-runtime.ts';

describe("Temporal's runtime installed for a server", () => {
  it('handles no signals, and hands the server warnings and errors with only the fields that describe them', async () => {
    const entries: TemporalLogEntry[] = [];
    installTemporalRuntime((entry) => {
      entries.push(entry);
    });
    installTemporalRuntime(() => {
      entries.push({ level: 'ERROR', message: 'installed twice', context: {} });
    });
    const { logger, options } = Runtime.instance();

    logger.info('Worker state changed', { taskQueue: 'brains' });
    logger.warn('Activity failed', {
      taskQueue: 'brains',
      workflowId: 'acme/alpha/flow/e',
      attempt: 2,
      isLocal: false,
      error: new Error('The ledger is busy'),
      activityInput: { secret: 'never' },
      headers: { authorization: 'never' },
    });
    logger.error('Worker failed');
    await vi.waitFor(() => {
      expect(entries).toHaveLength(2);
    });

    expect(options.shutdownSignals).toStrictEqual([]);
    expect(entries).toStrictEqual([
      {
        level: 'WARN',
        message: 'Activity failed',
        context: { taskQueue: 'brains', workflowId: 'acme/alpha/flow/e', attempt: 2, error: 'The ledger is busy' },
      },
      { level: 'ERROR', message: 'Worker failed', context: {} },
    ]);
  });
});
