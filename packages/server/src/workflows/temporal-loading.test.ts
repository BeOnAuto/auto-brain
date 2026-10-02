import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, inject, it } from 'vitest';

import { spawnServer } from '../testing/spawned-server.ts';
import { temporaryLedger } from '../testing/temporary-ledger.ts';
import { workflowTestTimeoutMs } from '../testing/workflow-server.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const countingTemporalModules = fileURLToPath(new URL('../testing/temporal-modules.ts', import.meta.url));

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

async function temporalModulesLoaded(environment: Readonly<Record<string, string>>): Promise<number> {
  const child = spawnServer(mainModule, {
    HOME: homedir(),
    HOST: '127.0.0.1',
    PORT: '0',
    LOCAL_MODE: 'true',
    LEDGER_FILE: ledger.fileName,
    NODE_OPTIONS: `--import ${countingTemporalModules}`,
    ...environment,
  });
  await child.port;
  child.signal('SIGTERM');
  await child.exited;
  return Number(/^Temporal modules loaded: (\d+)$/mu.exec(child.output().stderr)?.[1]);
}

describe('a server', { timeout: workflowTestTimeoutMs }, () => {
  it('loads no module of Temporal without TEMPORAL_ADDRESS, and loads them with it', async () => {
    const without = await temporalModulesLoaded({});
    const withTemporal = await temporalModulesLoaded({
      TEMPORAL_ADDRESS: inject('temporalAddress'),
      TEMPORAL_TASK_QUEUE: `server-${randomUUID()}`,
    });

    expect(without).toBe(0);
    expect(withTemporal).toBeGreaterThan(10);
  });
});
