import { InvalidInput, Unavailable } from '@beonauto/operations';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { poolOf, recallWith, workerTestTimeoutMs } from '../testing/recall-runs.ts';
import { parseRecallDocument } from './document-parsing.ts';

const filtered = [
  'language: typescript',
  'source:',
  '  events:',
  '    - type: order_placed',
  "      data: '${ $data.total > 100 }'",
  '    - type: order_cancelled',
  "      data: '${ $workflow.input.limit < $data.total }'",
].join('\n');

function checking(source: string) {
  return Effect.runPromiseExit(recallWith().prepared(source).check);
}

describe('the filter expressions of a recall function', () => {
  it('are kept with where the document holds them, for its check', () => {
    expect(
      Result.map(
        parseRecallDocument(recallDocument(foldOf('return view;'), filtered)),
        (document) => document.filterExpressions,
      ),
    ).toEqual(
      Result.succeed([
        { source: ' $data.total > 100 ', pointer: '/source/events/0/data', line: 6 },
        { source: ' $workflow.input.limit < $data.total ', pointer: '/source/events/1/data', line: 8 },
      ]),
    );
  });
});

describe('the check of a recall function when it is saved', { timeout: workerTestTimeoutMs }, () => {
  it('accepts the example of the reference, answering its module stripped of its types', async () => {
    const strippedFold: unknown = expect.stringContaining('export function fold(view      , event       )       {');

    expect(await checking(campaignReviews)).toEqual(Exit.succeed({ module: strippedFold }));
  });

  it('refuses a filter that names more than $data, and a module that keeps state, at their lines', async () => {
    expect(await checking(recallDocument(`let seen = 0;\n${foldOf('return view;')}`, filtered))).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The recall function definition has 2 problems',
          issues: [
            { pointer: '', detail: "Line 8, /source/events/1/data: Cannot find name '$workflow'." },
            {
              pointer: '',
              detail:
                'Line 10: A module holds its types and its exported functions and nothing else, so that two calls share nothing',
            },
          ],
        }),
      ),
    );
  });

  it('is unavailable when its check does not answer', async () => {
    const pool = poolOf();
    const closing = {
      ...pool,
      check: () => Promise.resolve({ ran: 'stopped', because: 'closing', milliseconds: 1 } as const),
    };

    expect(await Effect.runPromiseExit(recallWith(closing).prepared(campaignReviews).check)).toEqual(
      Exit.fail(new Unavailable({ detail: 'The server is stopping' })),
    );
  });
});
