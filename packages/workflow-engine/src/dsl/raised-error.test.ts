import { describe, expect, it } from 'vitest';

import { callErrorOf, errorAsJson, errorType, rejectionReasonOf, settlementOf } from './raised-error.ts';

describe('the rejection of an uncaught error', () => {
  it.each([400, 401, 403, 404, 409, 422, 499])('is invalid_input for the client error %d, a final result', (status) => {
    expect(rejectionReasonOf({ type: errorType('validation'), status, instance: '/' })).toBe('invalid_input');
  });

  it.each([408, 429, 500, 503, 302, 0])('is unavailable for %d, which retrying may get past', (status) => {
    expect(rejectionReasonOf({ type: errorType('runtime'), status, instance: '/' })).toBe('unavailable');
  });
});

describe('the rejection of an uncaught error of a kind with a type of its own', () => {
  it('takes the reason of its kind, with its kind and because, so its words never say its input can be corrected', () => {
    const called = callErrorOf(
      { status: 'rejected', reason: 'conflict', detail: 'Called before', kind: 'tools_called' },
      { function: 'notify', label: 'the function notify', reference: '/do/0/ask' },
    );
    const unfinished = callErrorOf(
      { status: 'rejected', reason: 'unavailable', detail: 'Stopped', kind: 'tools_unfinished', because: 'run_bound' },
      { function: 'notify', label: 'the function notify', reference: '/do/0/ask' },
    );

    expect([
      settlementOf({ kind: 'raised', error: called }),
      settlementOf({ kind: 'raised', error: unfinished }),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The function notify rejected the execution with conflict: Called before (at /do/0/ask)',
        kind: 'tools_called',
      },
      {
        status: 'rejected',
        reason: 'unavailable',
        detail: 'The function notify rejected the execution with unavailable: Stopped (at /do/0/ask)',
        kind: 'tools_unfinished',
        because: 'run_bound',
      },
    ]);
    expect(rejectionReasonOf({ ...called, type: errorType('runtime') })).toBe('invalid_input');
  });
});

describe('the error of a call that did not succeed', () => {
  const site = { function: 'notify', label: 'the function notify', reference: '/do/0/ask' };

  it('is a runtime error, status 500, for a rejection whose reason it does not know', () => {
    expect(callErrorOf({ status: 'rejected', reason: 'teapot', detail: 'short and stout' }, site)).toEqual({
      type: errorType('runtime'),
      status: 500,
      title: 'The function notify rejected the execution with teapot',
      detail: 'short and stout',
      instance: '/do/0/ask',
    });
  });

  it('carries the kind and because of a rejection, which a document reads in the error it catches', () => {
    const rejected = {
      status: 'rejected',
      reason: 'unavailable',
      detail: 'A tool server kept failing',
      kind: 'tools_unfinished',
      because: 'server_failed',
    } as const;

    expect(errorAsJson(callErrorOf(rejected, site))).toEqual({
      type: 'https://on.auto/problems/tools_unfinished',
      status: 503,
      title: 'The function notify rejected the execution with unavailable',
      detail: 'A tool server kept failing',
      instance: '/do/0/ask',
      kind: 'tools_unfinished',
      because: 'server_failed',
    });
    expect(
      callErrorOf({ status: 'rejected', reason: 'conflict', detail: 'Called', kind: 'tools_called' }, site),
    ).not.toHaveProperty('because');
  });
});

describe('the type of the error of a call rejected with a kind', () => {
  const site = { function: 'notify', label: 'the function notify', reference: '/do/0/ask' };

  it('is of the type of its own a kind has, never a communication error, and of the type of its reason for any other kind', () => {
    const unavailable = { status: 'rejected', reason: 'unavailable', detail: 'No' } as const;

    expect([
      callErrorOf({ ...unavailable, kind: 'tools_unfinished' }, site).type,
      callErrorOf({ ...unavailable, kind: 'mcp_server_failed' }, site).type,
      callErrorOf({ status: 'rejected', reason: 'conflict', detail: 'No', kind: 'tools_called' }, site),
    ]).toEqual([
      'https://on.auto/problems/tools_unfinished',
      errorType('communication'),
      {
        type: 'https://on.auto/problems/tools_called',
        status: 409,
        title: 'The function notify rejected the execution with conflict',
        detail: 'No',
        instance: '/do/0/ask',
        kind: 'tools_called',
      },
    ]);
  });
});
