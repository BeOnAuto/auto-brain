import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import {
  asking,
  brief,
  guarded,
  interactionServerOn,
  servingInteractions,
} from '../testing/servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

function ledgerFile(): string {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger.fileName;
}

function expiredAgo(file: string, milliseconds: number): void {
  const database = new DatabaseSync(file);
  const past = Date.now() - milliseconds;
  database.prepare('UPDATE open_requests_2 SET expires_at = ?, ending_due_at = ?').run(past, past);
  database.close();
}

const unansweredAsExpired = { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired' } };

describe('requests past their expiry while the server was stopped', { timeout: workflowTestTimeoutMs }, () => {
  it('end unanswered as expired from the read model alone, which a catch names and an uncaught call passes on', async () => {
    const file = ledgerFile();
    const first = await servingInteractions('inbox', { LEDGER_FILE: file });
    const asked = await first.ask('approve-brief');
    const caught = await first.workflow('guarded', guarded('approve-brief', 'expired'));
    const uncaught = await first.workflow('approval', `do:\n${asking('approve-brief', 'approve')}`);
    await first.openRequests(3);
    await first.stop();
    expiredAgo(file, 1000);

    const second = await interactionServerOn({ LEDGER_FILE: file });

    expect(await second.settled(asked)).toMatchObject(unansweredAsExpired);
    expect(await second.settled(caught)).toMatchObject({ status: 'succeeded', output: { caught: 'expired' } });
    expect(await second.settled(uncaught)).toMatchObject(unansweredAsExpired);
    expect(await second.openRequests(0)).toEqual([]);
    expect(
      await second.call('POST', `${alpha}/specs/interaction/approve-brief/execute`, {
        body: { input: brief, execution_id: asked },
      }),
    ).toMatchObject({ status: 410, body: { type: 'https://on.auto/problems/unanswered', kind: 'expired' } });
  });
});
