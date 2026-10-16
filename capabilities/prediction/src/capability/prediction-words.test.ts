import { describe, expect, it } from 'vitest';

import { describeOutput } from './prediction-words.ts';

const observed = { name: 'observed', points: [{ at: '2026-W41', value: 118 }] };

const prediction = {
  unit: 'orders',
  period: 'week',
  origin: '2026-W41',
  lines: [
    observed,
    {
      name: 'predicted',
      points: [
        { at: '2026-W42', value: 120.5, low: 96, high: 1250 },
        { at: '2026-W45', value: 131, low: 100, high: 160 },
      ],
    },
  ],
};

describe('the words of what a run of a prediction function answers', () => {
  it('say each predicted point with its range, from the last period observed and the version that made them', () => {
    expect(describeOutput(prediction, { version: 3, coverage: 0.8 })).toBe(
      'From 2026-W41, it predicts 120.5 in 2026-W42 (96 to 1,250) and 131 in 2026-W45 (100 to 160), each range holding the truth eight times in ten, from version 3 of its model.',
    );
    expect(
      describeOutput({
        ...prediction,
        lines: [observed, { name: 'predicted', points: [{ at: '2026-W42', value: 7, low: 6, high: 8 }] }],
      }),
    ).toBe('From 2026-W41, it predicts 7 in 2026-W42 (6 to 8), its range holding the truth eight times in ten.');
  });

  it('say what a build kept, and that it kept nothing when no candidate won or none was uploaded', () => {
    const sha256 = 'ab'.repeat(32);

    expect(describeOutput({ version: 2, winner: sha256, candidates: [{ sha256, verdict: 'won' }] })).toBe(
      'The build made version 2 of its model from one candidate, won by abababababab.',
    );
    expect(describeOutput({ version: null, winner: null, candidates: [{}, {}] })).toBe(
      'The build kept no version: none of its 2 candidates beat the baselines on the held-back periods.',
    );
    expect(describeOutput({ version: null, winner: null, candidates: [] })).toBe(
      'The build kept no version, since no candidate was uploaded before its answer.',
    );
  });

  it('say any other output as a result', () => {
    expect(describeOutput({ answer: 4 })).toBe('Its result: answer: 4.');
  });
});
