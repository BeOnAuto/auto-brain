import { describe, expect, it } from 'vitest';

import { explanationOf, unsuccessfulWords, rejected, type ExplainedRejection } from '../index.ts';

const ofPrediction: ReadonlyArray<readonly [ExplainedRejection, string]> = [
  [{ reason: 'conflict', kind: 'no_active_version' }, 'the function has no model that answers yet'],
  [
    { reason: 'conflict', kind: 'data_changed' },
    'the data part of the function changed since its active version was built, so that model no longer fits its rows',
  ],
  [{ reason: 'conflict', kind: 'build_in_flight' }, 'a build of the function is already in flight'],
  [{ reason: 'conflict', kind: 'dataset_too_large' }, 'its dataset holds more rows or series than a build takes'],
  [{ reason: 'conflict', kind: 'not_a_build' }, 'the run named is not a build of a prediction function'],
  [
    { reason: 'conflict', kind: 'build_ended' },
    'the build has ended or has taken its answer, so it takes nothing more from its trainer',
  ],
  [{ reason: 'conflict', kind: 'already_active' }, 'that version is already the active one'],
  [{ reason: 'unavailable', kind: 'builds_full' }, 'this server is scoring as many builds as it may at once'],
  [
    { reason: 'unavailable', kind: 'builds_full', because: 'builds_of_the_day' },
    'the function has had its builds of the day',
  ],
  [
    { reason: 'unavailable', kind: 'dataset_not_ready' },
    'its dataset is still being built from the playbook’s history',
  ],
  [
    { reason: 'unavailable', kind: 'dataset_not_ready', because: 'stalled' },
    'its dataset stopped at an event its fold could not take',
  ],
  [{ reason: 'unavailable', kind: 'model_process_busy' }, 'every model process of this server is busy'],
  [
    { reason: 'unavailable', kind: 'model_process_failed' },
    'the process that runs the model ended, or answered something other than finite numbers, before it answered',
  ],
  [
    { reason: 'unavailable', kind: 'model_process_failed', because: 'not_finite' },
    'the model answered something other than finite numbers in the shape its signature gives',
  ],
];

const aSentence: unknown = expect.stringMatching(/\.$/u);

describe('the explanation of a refusal of a prediction function', () => {
  it.each(ofPrediction)('explains %j and says what to do', (rejection, why) => {
    expect(explanationOf(rejection)).toMatchObject({ why, remedy: aSentence });
  });

  it('says how to ask for a build when no version is active, and that nothing was changed', () => {
    expect(unsuccessfulWords('predict', 'command', rejected('conflict', 'x', undefined, 'no_active_version'))).toBe(
      'Could not predict: the function has no model that answers yet. Nothing was changed. It answers once a build has given it an active version: ask for one with the input { build: {} }.',
    );
  });
});
