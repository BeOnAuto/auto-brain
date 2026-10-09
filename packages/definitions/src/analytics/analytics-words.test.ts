import { describe, expect, it } from 'vitest';

import { defineGetBrainAnalytics } from '../index.ts';
import { echo } from '../testing/echo.ts';
import type { BrainAnalytics } from './analytics-answer.ts';

const { plainLanguage } = defineGetBrainAnalytics([echo]).registration;

const quiet: BrainAnalytics = {
  days: 7,
  runs: { total: 0, succeeded: 0, failed: 0, rejected: 0 },
  tokens: { input: 0, output: 0, cached: 0 },
  duration_ms: null,
  by_day: [],
  by_function: [],
};

const busy: BrainAnalytics = {
  ...quiet,
  runs: { total: 312, succeeded: 300, failed: 1, rejected: 11 },
  tokens: { input: 15_000, output: 2400, cached: 9000 },
  duration_ms: { p50: 450, p95: 4800 },
};

describe('the plain words of get_brain_analytics', () => {
  it('say what was asked for', () => {
    expect([
      plainLanguage?.attempt({}),
      plainLanguage?.attempt({ days: 30, type: 'echo', name: 'hello' }),
      plainLanguage?.attempt({ from: '2026-09-01', to: '2026-09-30', type: 'echo' }),
      plainLanguage?.attempt({ name: 'hello', from: '2026-09-01' }),
      plainLanguage?.attempt({ days: 'many' }),
    ]).toEqual([
      'read how the runs went over the last 7 days',
      'read how the runs of the greeting “hello” went over the last 30 days',
      'read how the runs of greetings went from 2026-09-01 to 2026-09-30',
      'read how the runs of anything named “hello” went over the days asked for',
      'read how the runs of the brain went',
    ]);
  });

  it('say how many runs ended, how, what they used and how long they took', () => {
    expect([
      plainLanguage?.outcome(quiet, {}),
      plainLanguage?.outcome(busy, { from: '2026-09-01', to: '2026-09-30' }),
      plainLanguage?.outcome({ ...quiet, runs: { total: 1, succeeded: 0, failed: 1, rejected: 0 } }, { days: 14 }),
    ]).toEqual([
      'Over the last 7 days, no runs ended in this brain.',
      'From 2026-09-01 to 2026-09-30, three hundred and twelve runs ended in this brain: three hundred finished, 11 did not go through, and 1 broke down. They used 15000 input and 2400 output tokens. Half of those that ran to an end took at most four hundred and fifty ms, and nineteen in twenty at most 4800 ms.',
      'Over the last 14 days, 1 run ended in this brain: 1 broke down.',
    ]);
  });
});
