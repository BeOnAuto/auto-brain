import { describe, expect, it } from 'vitest';

import { changedExpressions, noStrippedForms, runnableAttributes, runnableExpression } from './stripped-forms.ts';

const stripped = { expressions: { ' $data.total as number > 1 ': ' $data.total           > 1 ' } };

describe('the expressions a save keeps stripped', () => {
  it('are those the stripping changed, by their source, and none when it changed none', () => {
    expect(changedExpressions(['$data.a as number', '$data.b'], ['$data.a          ', '$data.b'])).toEqual({
      expressions: { '$data.a as number': '$data.a          ' },
    });
    expect(changedExpressions(['$data.b'], ['$data.b'])).toEqual({});
  });

  it('give a run the stripped form of an expression the save changed, and the source of any other', () => {
    expect(
      [' $data.total as number > 1 ', ' $data.total > 1 '].map((source) => runnableExpression(stripped, source)),
    ).toEqual([' $data.total           > 1 ', ' $data.total > 1 ']);
    expect(runnableExpression(noStrippedForms, '$data')).toBe('$data');
  });

  it('give a filter its attributes with each expression stripped, and every other attribute as written', () => {
    expect(
      runnableAttributes(
        { type: 'noted', source: '/ledger', data: '${ $data.total as number > 1 }', count: 2, nested: { a: '${ x }' } },
        stripped,
      ),
    ).toEqual({
      type: 'noted',
      source: '/ledger',
      data: '${ $data.total           > 1 }',
      count: 2,
      nested: { a: '${ x }' },
    });
  });
});
