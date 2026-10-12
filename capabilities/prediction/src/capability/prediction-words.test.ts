import { describe, expect, it } from 'vitest';

import { describeOutput } from './prediction-words.ts';

const prediction = {
  series: 'north',
  origin: '2026-W41',
  period: '2026-W45',
  horizon: 4,
  value: 120.5,
  low: 96,
  high: 1250,
  coverage: 0.8,
  version: 3,
};

describe('the words of what a run of a prediction function answers', () => {
  it('say a prediction with its interval and the version that made it', () => {
    expect(describeOutput(prediction)).toBe(
      'It predicts 120.5 for “north” in 2026-W45, 4 periods ahead, between 96 and 1250 eight times in ten, from version 3 of its model.',
    );
    expect(describeOutput({ ...prediction, horizon: 1, period: '2026-W42' })).toContain(
      'in 2026-W42, one period ahead',
    );
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
