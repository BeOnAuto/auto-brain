import { describe, expect, it } from 'vitest';

import { explanationOf, rejected, unsuccessfulWords, type ExplainedRejection } from '../index.ts';

const mayHaveReachedSomeone: ReadonlyArray<readonly [ExplainedRejection, string, string]> = [
  [
    { reason: 'unanswered' },
    'nobody answered what it asked',
    'Nothing more of it runs; asking again is a new run, which can be started if an answer is still needed.',
  ],
  [
    { reason: 'unanswered', kind: 'expired' },
    'nobody answered what it asked before the request expired',
    'Nothing more of it runs, though the request may have reached someone; asking again is a new run, which can be started, with more time if needed.',
  ],
  [
    { reason: 'unanswered', kind: 'undelivered' },
    'what it had to send could not be delivered, though every attempt was made',
    'Nothing more of it runs; whoever runs the server can look into the channel it names, and then a new run can send it again.',
  ],
];

const refusedBeforeAsking: ReadonlyArray<readonly [ExplainedRejection, string, string]> = [
  [
    { reason: 'unavailable', kind: 'channel_not_offered' },
    'this server does not offer the channel it names',
    'This can be put right on your side: whoever runs the server decides which channels this brain may use, so once it names one of those, it can be tried again.',
  ],
  [
    { reason: 'unavailable', kind: 'requests_full' },
    'the brain already holds as many open requests as it may',
    'Once some of them are answered, expire or are cancelled, it can be tried again.',
  ],
];

describe('the explanation of a request that went unanswered', () => {
  it.each(mayHaveReachedSomeone)('explains %j, which may have reached someone', (rejection, why, remedy) => {
    expect(explanationOf(rejection)).toEqual({ why, remedy, mayHaveChanged: true });
  });

  it('never says that nothing was changed, since the request may have reached someone', () => {
    expect(unsuccessfulWords('ask', 'command', rejected('unanswered', 'x', undefined, 'expired'))).toBe(
      'Could not ask: nobody answered what it asked before the request expired. Nothing more of it runs, though the request may have reached someone; asking again is a new run, which can be started, with more time if needed.',
    );
  });
});

describe('the explanation of a request refused before it asked', () => {
  it.each(refusedBeforeAsking)('explains %j', (rejection, why, remedy) => {
    expect(explanationOf(rejection)).toEqual({ why, remedy });
  });
});
