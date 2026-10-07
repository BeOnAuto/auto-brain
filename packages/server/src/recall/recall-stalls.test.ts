import { internalTermsIn, plainTextIn, problemIn, withMcpSession } from '@beonauto/api/testing';
import { recallDocument } from '@beonauto/recollection/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  brainWithReviews,
  inState,
  liveAt,
  liveWith,
  recallTestTimeoutMs,
  recalled,
  reviewed,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/servers/recall-server.ts';

const reviewRuns =
  'language: jq\nsource:\n  events:\n    - type: execution_succeeded\n      subject: inference/review-brief\nview:\n  initial: 0';

const takingObjectsOnly = [
  '. + 1',
  '| if ($event.data.output | type) == "string" then error("cannot take \\($event.data.output)") else . end',
].join('\n');

const decodeStalled = Schema.decodeUnknownSync(
  Schema.Struct({
    standing: Schema.Struct({
      folded: Schema.Number,
      stalled: Schema.Struct({
        event: Schema.Struct({ id: Schema.String, type: Schema.String, time: Schema.String }),
        kind: Schema.String,
        error: Schema.String,
        line: Schema.Number,
      }),
    }),
  }),
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function stalledServer(): Promise<ReasoningServer> {
  const server = await servingRecall(
    verdicts({ campaign: 'spring', verdict: 'approve' }, 'the secret plan of the spring campaign'),
  );
  closing.push(server.stop);
  await brainWithReviews(server);
  await server.call('POST', `${alpha}/specs/recollection`, {
    body: { name: 'objects', source: recallDocument(takingObjectsOnly, reviewRuns) },
  });
  await reviewed(server, 2);
  return server;
}

describe('a recall function whose view stalled', { timeout: recallTestTimeoutMs }, () => {
  it('stands stalled with the event, the kind and the raw error, and holds back no other view of the brain', async () => {
    const server = await stalledServer();

    const standing = decodeStalled(await standingUntil(server, 'objects', inState('stalled'))).standing;
    await standingUntil(server, 'reviews', liveWith(2));
    const reviews = await recalled(server, 'reviews', { campaign: 'unknown' });

    expect(standing).toMatchObject({
      folded: 1,
      stalled: { event: { type: 'execution_succeeded' }, kind: 'raised', line: 11 },
    });
    expect(standing.stalled.error).toBe('cannot take the secret plan of the spring campaign');
    expect(reviews).toMatchObject({ status: 200, body: { output: [{ verdict: 'none' }] } });
  });

  it('answers a conflict, stalled, in fixed words with the type and time of the event and the line, never its values or id', async () => {
    const server = await stalledServer();
    const { stalled } = decodeStalled(await standingUntil(server, 'objects', inState('stalled'))).standing;

    const ran = await recalled(server, 'objects', {});

    expect(ran).toMatchObject({
      status: 409,
      body: {
        reason: 'conflict',
        kind: 'stalled',
        detail: `The view of the recall function “objects” stopped at the execution_succeeded event of ${stalled.event.time}: its fold raised an error on line 11. Save a corrected version to build the view again from the brain's history`,
      },
    });
    expect(ran.text).not.toContain('secret');
    expect(ran.text).not.toContain(stalled.event.id);
  });
});

describe('a recall function whose view stalled, afterwards', { timeout: recallTestTimeoutMs }, () => {
  it('is repaired by saving a corrected version, which builds the view again from the history', async () => {
    const server = await stalledServer();
    await standingUntil(server, 'objects', inState('stalled'));

    await server.call('PUT', `${alpha}/specs/recollection/objects`, {
      body: { source: recallDocument('. + 1', reviewRuns) },
    });
    await standingUntil(server, 'objects', liveAt(2));

    expect(await recalled(server, 'objects', {})).toMatchObject({ status: 200, body: { output: 2 } });
  });

  it('tells an agent over MCP of the conflict and its kind in plain words', async () => {
    const server = await stalledServer();
    await standingUntil(server, 'objects', inState('stalled'));

    const executed = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} },
      (session) => session.callTool('execute_spec', { primitive: 'recollection', name: 'objects', input: {} }),
    );

    expect({ isError: executed.isError, problem: problemIn(executed) }).toMatchObject({
      isError: true,
      problem: { status: 409, reason: 'conflict', kind: 'stalled' },
    });
    expect(internalTermsIn(plainTextIn(executed))).toEqual([]);
    expect(plainTextIn(executed)).not.toContain('secret');
  });
});
