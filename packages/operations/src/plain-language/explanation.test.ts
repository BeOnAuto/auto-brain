import { describe, expect, it } from 'vitest';

import {
  explanationOf,
  rejected,
  unsuccessfulWords,
  type ConflictKind,
  type ExplainedRejection,
  type OperationKind,
  type RejectionReason,
} from '../index.ts';

const correctable = 'This can be corrected and tried again; the details below say what to change.';

const operator =
  'Only whoever runs the server can put this right, so there is nothing to change on your side; once they have, it can be tried again. Meanwhile, everything that does not need it still works.';

const byReason: ReadonlyArray<readonly [Exclude<RejectionReason, 'conflict'>, string, string]> = [
  ['invalid_input', 'what was given does not fit what it needs', correctable],
  ['unavailable', 'something the server relies on is not available right now', operator],
  [
    'not_found',
    'it, or something it refers to, could not be found',
    'Check the names used; the details below say what is missing.',
  ],
  ['forbidden', 'this connection is not allowed to do that', 'Whoever set up this connection can allow it.'],
];

const byConflict: ReadonlyArray<readonly [ConflictKind, string, string]> = [
  ['taken', 'that name is already taken', 'A different name will work.'],
  ['retired', 'it has been retired', 'What is retired stays retired; a new one can be made under another name.'],
  ['concurrent_change', 'something else changed it at the same moment', 'Trying again should work.'],
  ['unworkable', 'it cannot work as it is written', correctable],
];

const switchable =
  'This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.';

const notOffered: ReadonlyArray<readonly [string, ExplainedRejection, string]> = [
  [
    'without saying why',
    { reason: 'unavailable', kind: 'model_not_offered' },
    'this server does not offer the model named',
  ],
  [
    'because its provider is not set up',
    { reason: 'unavailable', kind: 'model_not_offered', because: 'provider_not_configured' },
    'this server does not offer the model named, because its provider is not set up on this server, though others are',
  ],
  [
    'because it is not allowed',
    { reason: 'unavailable', kind: 'model_not_offered', because: 'model_not_allowed' },
    'this server does not offer the model named, because it is not among the models whoever runs the server allows',
  ],
];

const afterStopping: ReadonlyArray<readonly [OperationKind, string]> = [
  ['command', 'It may or may not have taken effect, so check before trying again.'],
  ['query', 'It can be tried again once the server is back.'],
];

describe('explanationOf', () => {
  it.each(byReason)('explains %s', (reason, why, remedy) => {
    expect(explanationOf({ reason })).toEqual({ why, remedy });
  });

  it.each(byConflict)('explains a conflict of the kind %s', (kind, why, remedy) => {
    expect(explanationOf({ reason: 'conflict', kind })).toEqual({ why, remedy });
  });

  it.each(notOffered)('explains a model the server does not offer, %s', (_case, rejection, why) => {
    expect(explanationOf(rejection)).toEqual({ why, remedy: switchable });
  });

  it('explains a conflict that does not say its kind', () => {
    expect(explanationOf({ reason: 'conflict' })).toEqual({
      why: 'it clashes with something already there',
      remedy: 'The details below say what is in the way.',
    });
  });
});

describe('unsuccessfulWords', () => {
  it('says what could not be done, why, that nothing changed, and what to do, for a command', () => {
    expect(
      unsuccessfulWords('create the brain “Sales”', 'command', rejected('conflict', 'x', undefined, 'taken')),
    ).toBe(
      'Could not create the brain “Sales”: that name is already taken. Nothing was changed. A different name will work.',
    );
  });

  it('does not say that nothing changed for a query, which changes nothing', () => {
    expect(unsuccessfulWords('look up the brain “sales”', 'query', rejected('not_found', 'x'))).toBe(
      'Could not look up the brain “sales”: it, or something it refers to, could not be found. Check the names used; the details below say what is missing.',
    );
  });

  it('gives the reference of an unexpected failure, and says it was not the person’s doing', () => {
    expect(
      unsuccessfulWords('run the reasoning function “summary”', 'command', { status: 'failed', incident: 'abc' }),
    ).toBe(
      'Could not run the reasoning function “summary”: something went wrong inside the server. It was not caused by anything you did. If it happens again, whoever runs the server can look into it with this reference: abc.',
    );
  });

  it.each(afterStopping)('says what to do after a %s the server stopped', (kind, next) => {
    expect(unsuccessfulWords('do it', kind, { status: 'cancelled' })).toBe(
      `Could not do it: the server stopped before it finished. ${next}`,
    );
  });
});
