import { issueText } from '@beonauto/definitions/document';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recallDocument } from '../testing/campaign-reviews.ts';
import { parseRecallDocument } from './document-parsing.ts';

function withEvents(events: string): string {
  return recallDocument('. + 1', `language: jq\nsource:\n  events: ${events}`);
}

function issuesIn(source: string): readonly string[] {
  return Result.match(parseRecallDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

function filtersOf(source: string): unknown {
  return Result.map(parseRecallDocument(source), ({ details }) => details.filters);
}

describe('the events a recall function folds', () => {
  it('are named by filters of a literal type, and optionally a literal source and subject and data, kept as written', () => {
    const filters = [
      '{type: run_succeeded, subject: reasoning/review-brief}',
      '{type: com.acme.ledger.month-closed, source: /ledger/eu, data: "${ .revenue > 100 }"}',
      '{type: com.acme.ping, data: {region: eu}}',
    ];

    expect(filtersOf(withEvents(`[${filters.join(', ')}]`))).toEqual(
      Result.succeed([
        { type: 'run_succeeded', subject: 'reasoning/review-brief' },
        { type: 'com.acme.ledger.month-closed', source: '/ledger/eu', data: '${ .revenue > 100 }' },
        { type: 'com.acme.ping', data: { region: 'eu' } },
      ]),
    );
  });

  it('are named by at least one filter and at most eight', () => {
    const nine = Array.from({ length: 9 }, (_, index) => `{type: t${index}}`).join(', ');

    expect(issuesIn(withEvents('[]'))).toEqual([
      'Line 4, /source/events: A recall function folds the events at least one filter names; it names none',
    ]);
    expect(issuesIn(withEvents(`[${nine}]`))).toEqual([
      'Line 4, /source/events: A recall function takes at most 8 filters; it names 9',
    ]);
  });
});

describe('the filters a recall function refuses', () => {
  it('refuses a filter that is not a mapping, or names no literal type, each with its line', () => {
    expect(issuesIn(withEvents('\n    - run_succeeded\n    - {source: /ledger}\n    - {type: "${ .x }"}'))).toEqual([
      'Line 5, /source/events/0: A filter is a mapping of the attributes an event must have: type, and optionally source, subject and data',
      'Line 6, /source/events/1/type: An event filter matched over the event alone names the type of the events it takes',
      'Line 7, /source/events/2/type: type is written out, not computed by an expression, so that it is matched as it is',
    ]);
  });

  it('refuses an attribute it does not test, a source or subject computed or empty, and data that reads a variable or does not compile', () => {
    const filters = [
      '    - {type: a, id: x}',
      '    - {type: b, subject: "${ . }", source: ""}',
      '    - {type: c, data: "${ $event.data }"}',
      '    - {type: d, data: "${ .x + }"}',
      '    - {type: e, data: "${ now }"}',
    ];

    expect(issuesIn(withEvents(`\n${filters.join('\n')}`))).toEqual([
      'Line 5, /source/events/0/id: An event filter matched over the event alone tests type, source, subject and data, not id',
      'Line 6, /source/events/1/source: source is text that is not empty',
      'Line 6, /source/events/1/subject: subject is written out, not computed by an expression, so that it is matched as it is',
      'Line 7, /source/events/2/data: data reads a variable, but a filter is matched over the event alone and is given none',
      'Line 8, /source/events/3/data: Unexpected token',
      'Line 9, /source/events/4/data: now reads the clock, so the same events would not fold to the same view; read the time of an event as $event.time',
    ]);
  });
});
