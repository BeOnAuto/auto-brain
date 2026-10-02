import { describe, expect, it } from 'vitest';

import { errorType } from './raised-error.ts';
import { rejectionReasonOf } from './settlement.ts';

describe('the rejection of an uncaught error', () => {
  it.each([400, 401, 403, 404, 409, 422, 499])('is invalid_input for the client error %d, a final result', (status) => {
    expect(rejectionReasonOf({ type: errorType('validation'), status, instance: '/' })).toBe('invalid_input');
  });

  it.each([408, 429, 500, 503, 302, 0])('is unavailable for %d, which retrying may get past', (status) => {
    expect(rejectionReasonOf({ type: errorType('runtime'), status, instance: '/' })).toBe('unavailable');
  });
});
