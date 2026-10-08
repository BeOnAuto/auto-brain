import { Ledger } from '@beonauto/operations';
import { memoryLedger } from '@beonauto/operations/testing';
import { Layer, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequests } from '../requests/open-requests.ts';
import { askedRunId, askedThroughChat, type HarnessLedger } from '../testing/index.ts';

const minute = 60_000;

const someText: unknown = expect.any(String);

const failing = { outcome: 'server_failure', detail: 'The MCP server answered HTTP 503', retryAfterMs: null } as const;

const Deferring = Schema.Struct({
  type: Schema.Literal('finish'),
  result: Schema.Struct({ type: Schema.Literal('execution_deferred'), record: Schema.JsonObject }),
});

const isDeferring = Schema.is(Deferring);

const grownArguments = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`a${index}`, '{{ message }}']));

function growingArguments(ledger: HarnessLedger): HarnessLedger {
  const service: Ledger['Service'] = {
    ...ledger.service,
    execute: (stream, decider, command, given) => {
      if (!isDeferring(command)) {
        return ledger.service.execute(stream, decider, command, given);
      }
      const deliver = { server: 'chat', tool: 'post_message', with: grownArguments };
      const record = { ...command.result.record, deliver };
      return ledger.service.execute(stream, decider, { ...command, result: { ...command.result, record } }, given);
    },
  };
  return { service, layer: Layer.succeed(Ledger, service) };
}

describe('a delivery that fails for a while', () => {
  it('is tried again on the schedule, a minute after a failure', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    tools.answerNext(failing);

    await brain.performDue(askedAt);
    const tooSoon = await brain.performDue(Date.now() + minute - 5000);
    await brain.performDue(Date.now() + minute + 5000);

    expect([tooSoon, tools.calls().length]).toEqual([0, 2]);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 2, standing: 'delivered' });
  });

  it('honours the wait a 429 asks for within the schedule', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    tools.answerNext({ ...failing, detail: 'The MCP server answered HTTP 429', retryAfterMs: 120_000 });

    await brain.performDue(askedAt);
    const afterTheSchedule = await brain.performDue(Date.now() + minute + 5000);
    const afterTheWait = await brain.performDue(Date.now() + 2 * minute + 5000);

    expect([afterTheSchedule, afterTheWait, tools.calls().length]).toEqual([0, 1, 2]);
  });

  it('stays open after five failed attempts, delivered no more, until it expires', async () => {
    const { brain, tools, askedAt } = await askedThroughChat();
    tools.answerNext(failing, failing, failing, failing, failing);

    await brain.performEach([0, 1, 2, 3, 4, 5].map((step) => askedAt + step * 20 * minute));

    expect(tools.calls()).toHaveLength(5);
    expect(await brain.firstOpen()).toMatchObject({ attempts: 5, standing: 'undelivered' });
    expect(await brain.runOf(askedRunId)).toMatchObject({ output: { status: 'started' } });
  });
});

describe('a delivery whose arguments grew past what a call may send', () => {
  it('is refused once without a call, even by two hosts, not tried again, and a notification ends undelivered', async () => {
    const ledger = growingArguments(memoryLedger(undefined, [openRequests]));
    const { brain, tools, askedAt } = await askedThroughChat({ notification: true, ledger });
    const items = await brain.dueItems(askedAt);

    await brain.performAll([...items, ...items], askedAt);
    await brain.performDue(askedAt + 30 * minute);

    expect(tools.calls()).toEqual([]);
    expect(await brain.firstOpen()).toBeUndefined();
    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'undelivered' } },
    });
  });
});

describe('a request nobody answered in time', () => {
  it('ends its run unanswered as expired, a final result for its id', async () => {
    const { brain, askedAt } = await askedThroughChat({ expires: 'PT1H' });

    await brain.performDue(askedAt + 61 * minute);

    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired' } },
    });
    expect(await brain.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId)).toMatchObject({
      status: 'rejected',
      reason: 'unanswered',
      kind: 'expired',
    });
    expect(await brain.firstOpen()).toBeUndefined();
  });
});

describe('a notification delivered through a tool', () => {
  it('succeeds once a delivery lands, with an empty output', async () => {
    const { brain, askedAt } = await askedThroughChat({ notification: true });

    await brain.performDue(askedAt);

    expect(await brain.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: someText } },
    });
  });

  it('waits for its next attempt after one that failed', async () => {
    const { brain, tools, askedAt } = await askedThroughChat({ notification: true });
    tools.answerNext(failing);

    await brain.performDue(askedAt);

    expect(await brain.runOf(askedRunId)).toMatchObject({ output: { status: 'started' } });
    expect(tools.calls()).toHaveLength(1);
  });
});
