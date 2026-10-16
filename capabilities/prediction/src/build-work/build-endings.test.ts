import { setTimeout as sleep } from 'node:timers/promises';

import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import {
  answered,
  askedBuild,
  runOf,
  savedFunction,
  standingOf,
  uploaded,
  workOf,
} from '../build-testing/built-versions.ts';
import { candidateSha256, performedOnce, performedUntilQuiet } from '../build-testing/due-driving.ts';
import { scriptedModels } from '../build-testing/scripted-models.ts';
import { buildsDue } from '../builds/builds-due.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const twoDays = 2 * 86_400_000;

describe('a build that its trainer does not answer', () => {
  it('ends unanswered as its request expires, and its row closes', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await performedUntilQuiet(playbook.due, twoDays);

    expect(await runOf(playbook, build)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired' } },
    });
    expect(await standingOf(playbook)).toMatchObject({ output: { standing: { build: null } } });
  });
});

describe('a build that is cancelled', () => {
  it('ends cancelled while it waits, and lets go of the candidates staged under it', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await uploaded(playbook, build, ['visits-mean']);
    await playbook.cancelled(build);
    await performedUntilQuiet(playbook.due);
    const staged = await Effect.runPromise(
      playbook.test.ports.ledger.content.staged(alpha, build, candidateSha256('visits-mean')),
    );

    expect(await runOf(playbook, build)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'requested' } },
    });
    expect(staged).toBeUndefined();
  });

  it('ends cancelled while a candidate is scored, the walk ended and its permit let go well before its deadline', async () => {
    const scripted = scriptedModels();
    const playbook = buildPlaybook({
      module: scripted.module,
      deadlines: { check: 30_000, run: 10_000, walk: 30_000 },
    });
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await uploaded(playbook, build, ['visits-mean']);
    await answered(playbook, build, { candidates: [candidateSha256('visits-mean')] });
    scripted.next('sleeps');
    const started = performance.now();
    const scoring = performedOnce(playbook.due, Date.now());
    await sleep(300);
    await playbook.cancelled(build);
    await scoring;
    const scoredFor = performance.now() - started;

    expect([scoredFor < 10_000, playbook.test.ports.permits.taken()]).toEqual([true, 0]);

    expect((await workOf(playbook, build)).map(({ type }) => type)).toEqual([
      'dataset_assembled',
      'candidate_uploaded',
    ]);
    expect(await runOf(playbook, build)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'cancelled' } },
    });
  });
});

describe('a build that was scored and has ended', () => {
  it('lets go of the scoring rows the server parsed for its candidates and baselines', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await uploaded(playbook, build, ['visits-mean']);
    await answered(playbook, build, { candidates: [candidateSha256('visits-mean')] });
    await performedUntilQuiet(playbook.due);
    const [assembled] = await workOf(playbook, build);
    const parses = { count: 0 };
    await Effect.runPromise(
      playbook.test.ports.caches.parsed.rowsOf(
        Schema.decodeUnknownSync(Schema.String)(assembled?.data['scoring_sha256']),
        () => {
          parses.count += 1;
          return Promise.resolve([]);
        },
      ),
    );

    expect([assembled?.type, parses.count]).toEqual(['dataset_assembled', 1]);
  });
});

describe('a build cancelled as the walk of its candidate ends', () => {
  it('takes the end of its run as done, and records nothing of the candidate', async () => {
    const scripted = scriptedModels();
    const playbook = buildPlaybook({ module: scripted.module });
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await uploaded(playbook, build, ['visits-mean']);
    await answered(playbook, build, { candidates: [candidateSha256('visits-mean')] });
    scripted.next('slow');
    const scoring = performedOnce(playbook.due, Date.now());
    await sleep(100);
    await playbook.cancelled(build);
    await scoring;

    expect((await workOf(playbook, build)).map(({ type }) => type)).toEqual([
      'dataset_assembled',
      'candidate_uploaded',
    ]);
  });
});

describe('a build after its server restarts', () => {
  it('carries on from the last fact it recorded', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await uploaded(playbook, build, ['visits-mean', 'visits-even']);
    await answered(playbook, build, { candidates: [candidateSha256('visits-mean'), candidateSha256('visits-even')] });
    await performedOnce(playbook.due, Date.now());
    const before = (await workOf(playbook, build)).length;
    const restarted = buildsDue({ ports: playbook.test.ports, runs: playbook.startChild });
    await performedUntilQuiet([restarted]);

    expect(before).toBe(4);
    expect(await runOf(playbook, build)).toMatchObject({ output: { status: 'succeeded', output: { version: 1 } } });
  });
});

describe('a build that two performs end at once', () => {
  it('is settled by one of them, the other taking the settlement as done', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await answered(playbook, build, { candidates: [] });
    await performedOnce(playbook.due, Date.now());
    const other = buildsDue({ ports: playbook.test.ports, runs: playbook.startChild });
    await Promise.all([performedOnce(playbook.due, Date.now()), performedOnce([other], Date.now())]);

    expect(await runOf(playbook, build)).toMatchObject({
      output: { status: 'succeeded', output: { version: null, winner: null, candidates: [] } },
    });
  });
});
