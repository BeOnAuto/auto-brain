import { uploadedDailyVisits } from '@on.auto/prediction/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { SpawnedServer } from '../testing/processes/spawned-server.ts';
import { requestTo, settledOver, workflowProcess } from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { runIdIn } from '../testing/servers/workflow-server.ts';
import { candidateFile, digestOf, visits } from './build-calls.ts';

const alpha = '/v1/orgs/acme/playbooks/alpha';

function ledgerFile(): string {
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  return ledger.fileName;
}

function stopped(server: SpawnedServer): Promise<unknown> {
  server.signal('SIGTERM');
  return server.exited;
}

async function put(port: number, path: string, type: string, body: string | Readonly<Uint8Array>): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}${alpha}${path}`, {
    method: path.endsWith('candidates') ? 'POST' : 'PUT',
    headers: { 'content-type': type },
    body: typeof body === 'string' ? body : new Uint8Array(body),
  });
  return response.status;
}

describe('a build asked of a server that does not hold the lease of the due work', { timeout: 120_000 }, () => {
  it('is scored and builds its version on the server that holds it, and answers on either', async () => {
    const file = ledgerFile();
    const holder = workflowProcess(file);
    const holding = await holder.port;
    const standby = workflowProcess(file);
    const port = await standby.port;
    await requestTo(port, 'POST', '', { playbook: 'alpha', name: 'Alpha' });
    const candidate = candidateFile('visits-mean');

    const kept = await put(port, `/datasets/${visits.sha256}`, 'text/csv', visits.text);
    await requestTo(port, 'POST', '/alpha/definitions/prediction', {
      name: 'daily-visits',
      source: uploadedDailyVisits(visits.sha256),
    });
    const build = runIdIn(
      (await requestTo(port, 'POST', '/alpha/definitions/prediction/daily-visits/run', { input: { build: {} } })).body,
    );
    const uploaded = await put(port, `/runs/${build}/build/candidates`, 'application/octet-stream', candidate);
    await requestTo(port, 'POST', `/alpha/runs/${build}/answer`, { answer: { candidates: [digestOf(candidate)] } });

    expect([kept, uploaded]).toEqual([200, 200]);
    expect(await settledOver(port, `/alpha/runs/${build}`)).toMatchObject({
      status: 'succeeded',
      output: { version: 1 },
    });
    expect(await settledOver(holding, `/alpha/runs/${build}`)).toMatchObject({ status: 'succeeded' });
    expect([await stopped(standby), await stopped(holder)]).toEqual([0, 0]);
  });
});
