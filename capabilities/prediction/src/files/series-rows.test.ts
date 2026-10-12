import { describe, expect, it } from 'vitest';

import { seriesRowsOf } from './series-rows.ts';

describe('the rows of each series in a file of the build', () => {
  it('group the periods, the values and the features of each series in the order the file gives them', () => {
    const text = [
      'series,period,visits,promotion',
      'north,2026-10-01,10,1',
      'south,2026-10-01,20,0',
      'north,2026-10-02,11,0',
    ].join('\r\n');

    expect(seriesRowsOf(text, 1)).toEqual([
      {
        series: 'north',
        periods: ['2026-10-01', '2026-10-02'],
        values: Float64Array.of(10, 11),
        features: Float64Array.of(1, 0),
      },
      { series: 'south', periods: ['2026-10-01'], values: Float64Array.of(20), features: Float64Array.of(0) },
    ]);
  });

  it('read an empty cell or one a row lacks as NaN, and a row with no period as an empty one', () => {
    expect(seriesRowsOf(['series,period,visits,promotion', 'north,2026-10-01,,', 'north'].join('\r\n'), 1)).toEqual([
      {
        series: 'north',
        periods: ['2026-10-01', ''],
        values: Float64Array.of(Number.NaN, Number.NaN),
        features: Float64Array.of(Number.NaN, Number.NaN),
      },
    ]);
  });
});
