import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';

import { probeWorkflowsPath, recordHistory } from '../../replay-corpus.ts';
import { settingsFor } from '../testing/temporal.ts';

describe('the Temporal global of Node inside the workflow sandbox', () => {
  it('is unreachable, since its clock reads real time and would break replay', async () => {
    const { address } = settingsFor('temporal-global');
    const native = await NativeConnection.connect({ address });
    const connection = await Connection.connect({ address });
    const temporal = new Client({ connection });
    const worker = await Worker.create({
      connection: native,
      taskQueue: 'temporal-global',
      workflowsPath: probeWorkflowsPath,
    });

    const seen: unknown = await worker.runUntil(
      temporal.workflow.execute('temporalGlobalProbe', { taskQueue: 'temporal-global', workflowId: 'temporal-global' }),
    );
    await recordHistory('temporal-global', () => temporal.workflow.getHandle('temporal-global').fetchHistory());
    await connection.close();
    await native.close();

    expect(Reflect.has(globalThis, 'Temporal')).toBe(true);
    expect(seen).toBe('undefined');
  }, 60_000);
});
