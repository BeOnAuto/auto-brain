import { issueText } from '@beonauto/specs/document';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recallDocument } from '../testing/campaign-reviews.ts';
import { parseRecallDocument } from './document-parsing.ts';
import { answerDialect, filterDialect, foldDialect } from './recall-dialects.ts';

const readsElsewhere =
  'reads something other than the view and its event or input, so the same history would not give the same answer';

const hostTimeZone = "reads the server's time zone, so it is not the same everywhere; use the UTC date functions";

const writesSideways =
  'writes outside the program; a fold answers only with the next view, and an answer only with its output';

const wrongAnswers = 'gives wrong answers in this dialect of jq; use reduce, foreach, limit or first instead';

const labelled = '(label $out | 1, break $out)';

const refusals: readonly (readonly [string, string, string])[] = [
  [
    'now',
    'reads the clock, so the same events would not fold to the same view; read the time of an event as $event.time',
    'now',
  ],
  ['env', readsElsewhere, 'env'],
  ['$ENV', readsElsewhere, '$ENV'],
  ['input', readsElsewhere, 'input'],
  ['inputs', readsElsewhere, 'inputs'],
  ['input_filename', readsElsewhere, 'input_filename'],
  ['input_line_number', readsElsewhere, 'input_line_number'],
  ['$__loc__', readsElsewhere, '$__loc__'],
  ['builtins', readsElsewhere, 'builtins'],
  ['$ARGS', 'reads arguments a recall function is never given; the fold reads $event and the answer $input', '$ARGS'],
  ['localtime', hostTimeZone, 'localtime'],
  ['strflocaltime', hostTimeZone, 'strflocaltime("%H")'],
  ['debug', writesSideways, 'debug'],
  ['stderr', writesSideways, 'stderr'],
  ['halt', writesSideways, 'halt'],
  ['halt_error', writesSideways, 'halt_error'],
  ['label', wrongAnswers, labelled],
  ['break', wrongAnswers, labelled],
];

function issuesIn(source: string): readonly string[] {
  return Result.match(parseRecallDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}

describe('the jq a recall function is written in', () => {
  it.each(refusals)('refuses %s in a fold at save, with its line', (name, why, program) => {
    expect(issuesIn(recallDocument(`.\n| ${program}`))).toContain(`Line 8: ${name} ${why}`);
  });

  it('refuses exactly the names the design of computation functions lists, and $ARGS, in a fold, an answer and a filter alike', () => {
    const names = refusals.map(([name]) => name).toSorted();

    expect(foldDialect.refused.map(({ name }) => name).toSorted()).toEqual(names);
    expect(answerDialect.refused).toBe(foldDialect.refused);
    expect(filterDialect.refused).toBe(foldDialect.refused);
    expect([foldDialect.variables, answerDialect.variables, filterDialect.variables]).toEqual([
      ['event'],
      ['input'],
      [],
    ]);
  });

  it('nests at most 128 levels, refused at save the same on any host', () => {
    expect(issuesIn(recallDocument(`${'1+'.repeat(5000)}1`))).toEqual([
      'Line 7: The program nests more than 128 levels deep',
    ]);
  });
});
