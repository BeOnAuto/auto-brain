import { internalTermsIn } from '@beonauto/api/testing';
import { recallDocument } from '@beonauto/recollection/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  brainWithReviews,
  foldsHeldUntilOpened,
  inState,
  liveAt,
  liveWith,
  recallTestTimeoutMs,
  recalled,
  reviewed,
  servingRecall,
  standingUntil,
  verdicts,
  type Gate,
} from '../testing/servers/recall-server.ts';

const reviewRuns =
  'language: jq\nsource:\n  events:\n    - type: execution_succeeded\n      subject: inference/review-brief\nview:\n  initial: 0';

const decodeDetail = Schema.decodeUnknownSync(Schema.Struct({ detail: Schema.String }));

const waitsToBuild: unknown = expect.stringContaining('waits to build');

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function servingWith(environment: Readonly<Record<string, string>>, gate?: Gate): Promise<ReasoningServer> {
  const server = await servingRecall(
    verdicts({ campaign: 'spring', verdict: 'approve' }, { campaign: 'autumn', verdict: 'reject' }),
    environment,
    gate?.poolOf,
  );
  closing.push(server.stop);
  return server;
}

async function serving(): Promise<ReasoningServer> {
  const server = await servingWith({});
  await brainWithReviews(server);
  return server;
}

function saved(server: ReasoningServer, name: string, fold: string) {
  return server.call('POST', `${alpha}/specs/recollection`, {
    body: { name, source: recallDocument(fold, reviewRuns) },
  });
}

function updated(server: ReasoningServer, name: string, fold: string) {
  return server.call('PUT', `${alpha}/specs/recollection/${name}`, {
    body: { source: recallDocument(fold, reviewRuns) },
  });
}

describe('a recall function whose view is being built', { timeout: recallTestTimeoutMs }, () => {
  it('answers at once, unavailable, rebuilding, with Retry-After, until its view has caught up', async () => {
    const gate = foldsHeldUntilOpened();
    const server = await servingWith({}, gate);
    await brainWithReviews(server, 1);
    await standingUntil(server, 'reviews', inState('rebuilding'));

    const askedAt = Date.now();
    const meanwhile = await recalled(server, 'reviews', { campaign: 'spring' });
    const answeredInMs = Date.now() - askedAt;
    gate.open();
    await standingUntil(server, 'reviews', liveWith(1));
    const caughtUp = await recalled(server, 'reviews', { campaign: 'spring' });

    expect(meanwhile).toMatchObject({
      status: 503,
      body: {
        type: 'https://on.auto/problems/rebuilding',
        reason: 'unavailable',
        kind: 'rebuilding',
        detail:
          "The recall function “reviews” is building its view of version 1 from the brain's history: it has folded 0 events so far, and is less than a second behind the brain's newest record; try again in a little while",
      },
    });
    expect(meanwhile.headers.get('retry-after')).toBe('5');
    expect(internalTermsIn(decodeDetail(meanwhile.body).detail)).toEqual([]);
    expect(answeredInMs).toBeLessThan(2000);
    expect(caughtUp).toMatchObject({ status: 200, body: { output: [{ verdict: 'approve' }] } });
  });

  it('builds the view of a new version from the start of the history, and answers by that version alone', async () => {
    const server = await serving();
    await saved(server, 'count', '. + 1');
    await reviewed(server, 2);
    await standingUntil(server, 'count', liveWith(2));

    const before = await recalled(server, 'count', {});
    await updated(server, 'count', '. + 10');
    const rebuilt = await standingUntil(server, 'count', liveAt(2));
    const after = await recalled(server, 'count', {});

    expect([before.body, after.body]).toMatchObject([
      { output: 2, spec_version: 1 },
      { output: 20, spec_version: 2 },
    ]);
    expect(rebuilt).toMatchObject({ standing: { folded: 2 } });
  });
});

describe('a recall function waiting for its view to be built', { timeout: recallTestTimeoutMs }, () => {
  it('waits behind the views being built when its brain builds as many as it may at once', async () => {
    const gate = foldsHeldUntilOpened();
    const server = await servingWith({ RECOLLECTION_MAX_REBUILDS: '1', RECOLLECTION_BRAINS_AT_ONCE: '1' }, gate);
    await brainWithReviews(server, 1, 'beta');
    await vi.waitFor(() => {
      expect(gate.held()).toBe(1);
    });
    await brainWithReviews(server, 1);
    await saved(server, 'count', '. + 1');
    gate.letThrough(1);

    const [first, second] = await Promise.all([
      standingUntil(server, 'reviews', inState('rebuilding')),
      standingUntil(server, 'count', inState('waiting')),
    ]);
    const waiting = await recalled(server, 'count', {});
    gate.open();
    await standingUntil(server, 'count', liveWith(1));

    expect([first, second]).toMatchObject([{ standing: { state: 'rebuilding' } }, { standing: { state: 'waiting' } }]);
    expect(waiting).toMatchObject({ status: 503, body: { kind: 'rebuilding', detail: waitsToBuild } });
  });
});
