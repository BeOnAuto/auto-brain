import { describe, expect, it } from 'vitest';

import type { LoadedModel, ModelFeeds } from './model-sessions.ts';
import { walked } from './walk-job.ts';

interface Fed {
  readonly names: readonly string[];
  readonly y: readonly number[];
  readonly given: readonly number[] | undefined;
  readonly h: bigint | undefined;
}

function fedOf(feeds: ModelFeeds): Fed {
  return {
    names: Object.keys(feeds),
    y: [...(feeds['y']?.data ?? [])].map(Number),
    given: feeds['given'] === undefined ? undefined : [...feeds['given'].data].map(Number),
    h: feeds['h'] === undefined ? undefined : BigInt(feeds['h'].data[0] ?? 0),
  };
}

function lastValueModel(steps: (feeds: ModelFeeds) => number, heard: (fed: Fed) => void = () => {}): LoadedModel {
  return {
    length: undefined,
    inputs: [],
    outputs: [],
    run: (feeds) => {
      heard(fedOf(feeds));
      const last = Number(feeds['y']?.data.at(-1));
      const answered = steps(feeds);
      return Promise.resolve({
        data: Float32Array.from({ length: answered * 3 }, (_, index) => last + (index % 3) - 1),
        dims: [1, answered, 3],
      });
    },
  };
}

const rows = [
  'series,period,visits,promotion',
  'north,2026-10-01,10,0',
  'north,2026-10-02,11,1',
  'north,2026-10-03,12,0',
  'north,2026-10-04,13,1',
  'south,2026-10-01,20,1',
  'south,2026-10-02,21,0',
  'south,2026-10-03,22,1',
  'south,2026-10-04,23,0',
].join('\r\n');

const walk = {
  model: 'm',
  threads: 1,
  rows: 'r',
  window: 4,
  holdout: 2,
  steps: 2,
  features: 0,
  given: [],
  remaining: null,
};

describe('a walk of a model over the held-back origins of each series', () => {
  it('feeds each series up to each held-back origin and answers every step of every origin, series by series', async () => {
    const seen: Fed[] = [];
    const answer = await walked(
      lastValueModel(
        () => 2,
        (fed) => {
          seen.push(fed);
        },
      ),
      walk,
      rows,
    );

    expect(answer).toEqual({
      series: ['north', 'south'],
      q: [
        Float32Array.of(11, 12, 13, 11, 12, 13, 12, 13, 14, 12, 13, 14),
        Float32Array.of(21, 22, 23, 21, 22, 23, 22, 23, 24, 22, 23, 24),
      ],
    });
    expect(seen.map(({ y }) => y)).toEqual([
      [10, 11, 12],
      [10, 11, 12, 13],
      [20, 21, 22],
      [20, 21, 22, 23],
    ]);
  });
});

describe('a walk of a model that takes given features or predicts a total', () => {
  it('feeds the given features of the steps ahead, NaN past the last row, and the periods to the end of a total as h', async () => {
    const seen: Fed[] = [];
    const givenWalk = { ...walk, features: 1, given: [0], remaining: [3, 1] };
    await walked(
      lastValueModel(
        () => 1,
        (fed) => {
          seen.push(fed);
        },
      ),
      givenWalk,
      rows,
    );

    expect(seen.slice(0, 2)).toEqual([
      { names: ['y', 'x', 'given', 'h'], y: [10, 11, 12], given: [1, Number.NaN, Number.NaN], h: 3n },
      { names: ['y', 'x', 'given', 'h'], y: [10, 11, 12, 13], given: [Number.NaN], h: 1n },
    ]);
  });

  it('answers badly when the model answers q of another shape', async () => {
    expect(
      await walked(
        lastValueModel(() => 3),
        walk,
        rows,
      ),
    ).toEqual({
      badly: 'The model answered q of the shape [1, 3, 3] where [1, 2, 3] was expected',
    });
  });
});
