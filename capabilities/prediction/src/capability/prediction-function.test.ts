import { Conflict, InvalidInput, Unavailable } from '@beonauto/operations';
import { Effect, Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { predictionRuns } from '../testing/prediction-runs.ts';
import { weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';

const question = { series: 'north', horizon: 4, given: { promotion: 1 } };

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], 1);

const longestBuildMs = 604_800_000 + 8 * 600_000 + 60_000;

const questionsRefused: readonly (readonly [string, Schema.JsonObject, string])[] = [
  ['a horizon it does not predict', { series: 'north', horizon: 2, given: { promotion: 1 } }, '/horizon'],
  ['a given name it does not list', { series: 'north', horizon: 1, given: { promotion: 1, price: 2 } }, '/given/price'],
  ['no series', { horizon: 1, given: { promotion: 1 } }, '/series'],
];

function issueAt(pointer: string): unknown {
  return expect.objectContaining({ pointer });
}

describe('the prediction capability', () => {
  it('is the type prediction, written in Markdown, guided by prediction-function, with no facts of its own', () => {
    const { capability } = predictionRuns();

    expect([capability.type, capability.title, capability.mediaType, capability.guide, capability.noun]).toEqual([
      'prediction',
      'Prediction',
      'text/markdown',
      { name: 'prediction-function' },
      { one: 'prediction function', other: 'prediction functions' },
    ]);
    expect([capability.facts, capability.mostActive, predictionRuns(undefined, 3).capability.mostActive]).toEqual([
      { onRuns: [], streams: [] },
      32,
      3,
    ]);
  });

  it('refuses a document that is not one, naming each problem', async () => {
    const refused = await Effect.runPromiseExit(
      predictionRuns().capability.prepare(weeklyOrdersWith(['  horizons: [1, 4]', '  horizons: [4, 4]'])),
    );

    expect(refused).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The prediction function definition has a problem',
          issues: [
            {
              pointer: '',
              detail: 'Line 7, /predicts/horizons/1: The horizon 4 is named more than once; name each horizon once',
            },
          ],
        }),
      ),
    );
  });
});

describe('the summary of a prediction function', () => {
  it('derives the input of a question and of a build, the output of a prediction and of a build, and keeps the data part for its dataset', () => {
    expect(predictionRuns().prepared(weeklyOrders).summary).toMatchObject({
      description: 'Predicts the orders of each region one and four weeks ahead',
      inputSchema: {
        oneOf: [
          {
            title: 'question',
            required: ['series', 'horizon', 'given'],
            properties: { horizon: { type: 'integer', enum: [1, 4] }, given: { required: ['promotion'] } },
          },
          { title: 'build', required: ['build'] },
        ],
      },
      outputSchema: { oneOf: [{ title: 'prediction' }, { title: 'build' }] },
      details: { data_sha256: aDigest, data: { period: 'week', events: [{ type: 'order.placed' }], window: 156 } },
    });
  });

  it('has no description when its document has none', () => {
    const bare = weeklyOrdersWith(['description: Predicts the orders of each region one and four weeks ahead', '']);

    expect(predictionRuns().prepared(bare).summary.description).toBeUndefined();
  });
});

describe('a run of a prediction function before a version is built', () => {
  it('refuses a question, since no version is active yet, and says how to build one', async () => {
    expect(await predictionRuns().running(weeklyOrders, question)).toEqual(
      Exit.fail(
        new Conflict({
          detail: 'The function has no active version yet; ask for a build with the input { build: {} }',
          kind: 'no_active_version',
        }),
      ),
    );
  });

  it('refuses a build as unavailable, since this runtime does not offer builds yet', async () => {
    expect(await predictionRuns().running(weeklyOrders, { build: {} })).toEqual(
      Exit.fail(
        new Unavailable({
          detail:
            'This runtime does not offer builds of a prediction function yet, so no version can be built; its dataset is kept meanwhile, as get_definition shows',
        }),
      ),
    );
  });
});

describe('the input of a run of a prediction function', () => {
  it.each(questionsRefused)('is refused for a question with %s, naming where', async (_case, input, pointer) => {
    const failure = await predictionRuns().refusing(weeklyOrders, input);

    expect(failure).toBeInstanceOf(InvalidInput);
    expect(failure).toMatchObject({ issues: [issueAt(pointer)] });
  });

  it('is refused for a build that carries anything, and for an input nested past 512 levels', async () => {
    const runs = predictionRuns();

    expect(await runs.refusing(weeklyOrders, { build: { now: true } })).toMatchObject({
      detail: 'The input is not a build, which is { build: {} }',
    });
    expect(await runs.refusing(weeklyOrders, { series: 'north', horizon: 1, deep })).toMatchObject({
      detail: 'The input nests more than the 512 levels a prediction function takes',
    });
  });
});

describe('how long a run of a prediction function lasts', () => {
  it('is 10 s within its call for a question, and the expiry, eight candidates scored and its start for a build or an input it cannot tell', () => {
    const prepared = predictionRuns().prepared(weeklyOrders);

    expect([
      prepared.longestRunMs,
      prepared.longestRunMsFor(question),
      prepared.longestRunMsFor({ build: {} }),
    ]).toEqual([longestBuildMs, 10_000, longestBuildMs]);
    expect([prepared.finishesLaterFor(question), prepared.finishesLaterFor({ build: {} })]).toEqual([false, true]);
    expect([prepared.longestRunMsFor('anything'), prepared.finishesLaterFor({ series: 1 })]).toEqual([
      longestBuildMs,
      true,
    ]);
  });
});
