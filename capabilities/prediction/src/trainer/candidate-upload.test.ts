import type { RecordedContent } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { askedBuild, savedFunction, uploaded, workOf } from '../build-testing/built-versions.ts';
import { candidateBytes, candidateSha256, type CandidateName } from '../build-testing/due-driving.ts';
import { uploadCandidate } from './candidate-upload.ts';

const testTimeoutMs = 60_000;

const alpha = { org: 'acme', playbook: 'alpha' };

const someDetail: unknown = expect.any(String);

const notLoaded: unknown = expect.stringMatching(/^The file is not a model the runtime loads: /u);

const namesOtherInputs: unknown = expect.stringMatching(/^wrong_signature: The model's inputs are \[y, extra\]/u);

function sent(playbook: BuildPlaybook, build: string, name: CandidateName) {
  return playbook.send(uploadCandidate(playbook.test.ports), { run_id: build }, candidateBytes(name));
}

async function waitingBuild(playbook: BuildPlaybook): Promise<string> {
  await savedFunction(playbook);
  return askedBuild(playbook);
}

describe('a candidate a trainer uploads to a build', { timeout: testTimeoutMs }, () => {
  it('is checked and answered with its digest, its bytes and its opset, the same bytes again alike and recorded once', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);
    const answer = {
      status: 'succeeded',
      output: { candidate: candidateSha256('visits-mean'), bytes: candidateBytes('visits-mean').length, opset: 13 },
    };

    expect([await sent(playbook, build, 'visits-mean'), await sent(playbook, build, 'visits-mean')]).toEqual([
      answer,
      answer,
    ]);
    expect((await workOf(playbook, build)).map(({ type }) => type)).toEqual([
      'dataset_assembled',
      'candidate_uploaded',
    ]);
  });
});

function stagingThatFailsOnce(kept: RecordedContent): RecordedContent {
  const stages = { failed: false };
  return {
    ...kept,
    stage: (playbook, run, content) => {
      if (stages.failed) {
        return kept.stage(playbook, run, content);
      }
      stages.failed = true;
      return Effect.die(new Error('The server stopped before the candidate was staged'));
    },
  };
}

describe(
  'a candidate recorded but not staged, as when its server stops between the two',
  { timeout: testTimeoutMs },
  () => {
    it('is staged by the trainer sending the same bytes again', async () => {
      const playbook = buildPlaybook({ content: stagingThatFailsOnce });
      const build = await waitingBuild(playbook);
      const first = await sent(playbook, build, 'visits-mean');
      const unstaged = await Effect.runPromise(
        playbook.test.ports.ledger.content.staged(alpha, build, candidateSha256('visits-mean')),
      );
      const again = await sent(playbook, build, 'visits-mean');
      const staged = await Effect.runPromise(
        playbook.test.ports.ledger.content.staged(alpha, build, candidateSha256('visits-mean')),
      );

      expect([first.status, unstaged, again.status, staged?.bytes]).toEqual([
        'failed',
        undefined,
        'succeeded',
        candidateBytes('visits-mean').length,
      ]);
      expect((await workOf(playbook, build)).map(({ type }) => type)).toEqual([
        'dataset_assembled',
        'candidate_uploaded',
      ]);
    });
  },
);

describe('a candidate whose data names a file outside its own', { timeout: testTimeoutMs }, () => {
  it('reads none of another model the server keeps, by its digest beside it or in the folder of that model', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);
    await uploaded(playbook, build, ['visits-mean']);

    expect([await sent(playbook, build, 'visits-sibling'), await sent(playbook, build, 'visits-cousin')]).toMatchObject(
      [
        { status: 'rejected', reason: 'invalid_input', detail: notLoaded },
        { status: 'rejected', reason: 'invalid_input', detail: notLoaded },
      ],
    );
    expect((await workOf(playbook, build)).map(({ data }) => data['because'])).toEqual([
      undefined,
      undefined,
      'failed_to_load',
      'failed_to_load',
    ]);
  });
});

describe('a candidate a build does not take', { timeout: testTimeoutMs }, () => {
  it('is refused when the runtime does not load it, when it is not in the signature the function feeds, or when it is older than opset 13', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);

    expect([
      await sent(playbook, build, 'not-a-model'),
      await sent(playbook, build, 'visits-extra-input'),
      await sent(playbook, build, 'visits-opset-12'),
      await sent(playbook, build, 'visits-hostile'),
    ]).toMatchObject([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: notLoaded,
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '', detail: namesOtherInputs }],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: "The model's opset is 12, and the playbook takes 13 or later",
      },
      { status: 'rejected', reason: 'invalid_input', detail: someDetail },
    ]);
    expect((await workOf(playbook, build)).map(({ data }) => data['because'])).toEqual([
      undefined,
      'failed_to_load',
      'wrong_signature',
      'wrong_signature',
      'failed_to_load',
    ]);
  });
});

describe('the candidates of a build', { timeout: testTimeoutMs }, () => {
  it('are refused past the eight a build takes', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);
    await uploaded(playbook, build, [
      'visits-last',
      'visits-wide',
      'visits-narrow',
      'visits-mean',
      'visits-week',
      'visits-steady',
      'visits-not-a-number',
      'visits-allocating',
    ]);

    expect(await sent(playbook, build, 'orders-last')).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The build has its 8 candidates',
    });
  });
});

describe('candidates a trainer uploads to a build at once', { timeout: testTimeoutMs }, () => {
  it('are taken once when they are the same bytes, both answered alike', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);

    const both = await Promise.all([sent(playbook, build, 'visits-mean'), sent(playbook, build, 'visits-mean')]);

    expect(both.map((answer) => answer.status)).toEqual(['succeeded', 'succeeded']);
    expect((await workOf(playbook, build)).map(({ type }) => type)).toEqual([
      'dataset_assembled',
      'candidate_uploaded',
    ]);
  });

  it('take the eighth candidate once, and refuse another that arrived beside it', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);
    await uploaded(playbook, build, [
      'visits-last',
      'visits-wide',
      'visits-narrow',
      'visits-mean',
      'visits-week',
      'visits-steady',
      'visits-not-a-number',
    ]);

    const both = await Promise.all([sent(playbook, build, 'visits-allocating'), sent(playbook, build, 'visits-even')]);

    expect(both.map(({ status }) => status).toSorted()).toEqual(['rejected', 'succeeded']);
    expect(both.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: 'conflict',
      detail: 'The build took its 8 candidates meanwhile',
    });
  });
});
