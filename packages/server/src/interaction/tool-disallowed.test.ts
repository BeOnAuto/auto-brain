import { DatabaseSync } from 'node:sqlite';

import { openRequests } from '@beonauto/interaction';
import { chatDelivery } from '@beonauto/interaction/testing';
import { projectedTableOf } from '@beonauto/operations';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { chatEnvironment, chatServer, deliveryHistoryOf } from '../testing/servers/chat-deliveries.ts';
import { interactionServerOn, servingInteractions } from '../testing/servers/interaction-server.ts';
import { until } from '../testing/servers/workflow-calls.ts';
import { workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const aNumber: unknown = expect.any(Number);

function dueNow(file: string): void {
  const database = new DatabaseSync(file);
  database.prepare(`UPDATE ${projectedTableOf(openRequests)} SET next_attempt_at = 0, attempt_due_at = 0`).run();
  database.close();
}

describe('a tool its operator disallowed after a request asked through it', { timeout: workflowTestTimeoutMs }, () => {
  it('fails the next attempt as a tool no longer offered, and the request stays open, answered through the inbox', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const unreachable = await chatServer();
    await unreachable.close();
    const first = await servingInteractions(chatDelivery, {
      ...chatEnvironment(unreachable.url),
      LEDGER_FILE: ledger.fileName,
    });
    const runId = await first.ask('approve-brief');
    const unreached = await until(
      () => deliveryHistoryOf(first, runId),
      (seen) => seen.length >= 2,
    );
    await first.stop();
    dueNow(ledger.fileName);

    const chat = await chatServer();
    const second = await interactionServerOn({
      ...chatEnvironment(chat.url, { allowed: ['echo'] }),
      LEDGER_FILE: ledger.fileName,
    });
    const facts = await until(
      () => deliveryHistoryOf(second, runId),
      (seen) => seen.length >= 4,
    );
    const answered = await second.answer(runId, { answer: { choice: 'approve' } });

    expect(unreached[1]).toEqual({
      type: 'delivery_ended',
      run_id: runId,
      by: 'brain:alpha',
      number: 1,
      outcome: 'failed',
      because: 'server_failure',
      detail: 'The MCP server chat could not be used: The MCP server could not be reached',
      duration_ms: aNumber,
    });
    expect(facts.at(-1)).toMatchObject({
      outcome: 'failed',
      because: 'tool_not_offered',
      detail: 'The operator of this server does not allow chat/post_message',
    });
    expect(answered.status).toBe(200);
    expect(chat.received()).toEqual([]);
  });
});
