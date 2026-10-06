import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recallDocument } from '@beonauto/recollection/testing';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/reasoning-server.ts';
import {
  brainWithReviews,
  liveWith,
  recallTestTimeoutMs,
  recalled,
  reviewed,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/recall-server.ts';

const runs = 'language: jq\nsource:\n  events:\n    - type: execution_succeeded\nview:\n  initial: 0';

const counting = recallDocument('. + 1', runs);

const countingTwice = recallDocument('. + 2', runs);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  const server = await servingRecall(verdicts({ campaign: 'spring', verdict: 'approve' }), environment);
  closing.push(server.stop);
  await brainWithReviews(server);
  return server;
}

function created(server: ReasoningServer, name: string) {
  return server.call('POST', `${alpha}/specs/recollection`, { body: { name, source: counting } });
}

function createdInTurn(server: ReasoningServer, names: readonly string[]): Promise<unknown> {
  return names.reduce<Promise<unknown>>((before, name) => before.then(() => created(server, name)), Promise.resolve());
}

describe('the recall functions a brain keeps', { timeout: recallTestTimeoutMs }, () => {
  it('are at most thirty-two, the thirty-third refused as a conflict, and another saved once one is retired', async () => {
    const server = await serving();
    await createdInTurn(
      server,
      Array.from({ length: 31 }, (_, index) => `count-${index}`),
    );

    const thirtyThird = await created(server, 'one-too-many');
    const anotherVersion = await server.call('PUT', `${alpha}/specs/recollection/count-0`, {
      body: { source: countingTwice },
    });
    await server.call('POST', `${alpha}/specs/recollection/count-1/retire`);
    const afterRetiring = await created(server, 'one-too-many');

    expect(thirtyThird).toMatchObject({
      status: 409,
      body: {
        reason: 'conflict',
        detail:
          'The brain keeps 32 active recall functions, and a brain may keep at most 32; retire one before creating another',
      },
    });
    expect([anotherVersion.status, afterRetiring.status]).toEqual([200, 201]);
  });
});

describe('the bound on the recall functions a brain keeps', { timeout: recallTestTimeoutMs }, () => {
  it('are bounded by a setting, and lowering it below the count refuses even a new version and changes nothing else', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'auto-brain-recall-'));
    onTestFinished(() => {
      rmSync(directory, { recursive: true, force: true });
    });
    const ledger = { LEDGER_FILE: join(directory, 'ledger.db') };
    const first = await serving({ ...ledger, RECOLLECTION_MAX_FUNCTIONS: '2' });
    await created(first, 'count');
    const third = await created(first, 'more');
    await first.stop();

    const lowered = await servingRecall([], { ...ledger, RECOLLECTION_MAX_FUNCTIONS: '1' });
    closing.push(lowered.stop);
    const anotherVersion = await lowered.call('PUT', `${alpha}/specs/recollection/count`, {
      body: { source: countingTwice },
    });
    await standingUntil(lowered, 'count', liveWith(0));
    const ran = await recalled(lowered, 'count', {});

    expect(third).toMatchObject({ status: 409 });
    expect(anotherVersion).toMatchObject({
      status: 409,
      body: {
        detail:
          'The brain keeps 2 active recall functions, and a brain may keep at most 1; retire one before saving another version',
      },
    });
    expect(ran).toMatchObject({ status: 200, body: { output: 0 } });
  });
});

describe('a retired recall function', { timeout: recallTestTimeoutMs }, () => {
  it('drop their view when they are retired, and a retired one runs no more', async () => {
    const server = await serving();
    await reviewed(server, 1);
    await standingUntil(server, 'reviews', liveWith(1));

    const retired = await server.call('POST', `${alpha}/specs/recollection/reviews/retire`);
    const read = await server.call('GET', `${alpha}/specs/recollection/reviews`);
    const ran = await recalled(server, 'reviews', { campaign: 'spring' });

    expect(retired.status).toBe(200);
    expect(read.body).not.toHaveProperty('standing');
    expect(ran).toMatchObject({ status: 409 });
  });
});
