import { describe, expect, it } from 'vitest';

import { problemOf, problemResponse, type ProblemReason } from '../index.ts';

const statusAndTitleByReason: ReadonlyArray<readonly [ProblemReason, number, string]> = [
  ['invalid_input', 422, 'Invalid input'],
  ['forbidden', 403, 'Forbidden'],
  ['not_found', 404, 'Not found'],
  ['conflict', 409, 'Conflict'],
  ['unavailable', 503, 'Unavailable'],
  ['client_closed_request', 499, 'Client closed request'],
  ['bad_request', 400, 'Bad request'],
  ['unauthenticated', 401, 'Unauthenticated'],
  ['origin_not_allowed', 403, 'Origin not allowed'],
  ['method_not_allowed', 405, 'Method not allowed'],
  ['content_too_large', 413, 'Content too large'],
  ['unsupported_media_type', 415, 'Unsupported media type'],
  ['internal', 500, 'Internal error'],
];

describe('problemOf', () => {
  it.each(statusAndTitleByReason)('describes %s with status %i and the title "%s"', (reason, status, title) => {
    expect(problemOf(reason, 'What happened')).toEqual({
      type: `https://on.auto/problems/${reason}`,
      title,
      status,
      detail: 'What happened',
      reason,
    });
  });

  it('carries the issues that point at invalid input', () => {
    const errors = [{ detail: 'Expected a string', pointer: '/name' }];

    expect(problemOf('invalid_input', 'The input is invalid', { errors })).toMatchObject({ errors });
  });
});

describe('problemResponse', () => {
  it('answers with the problem status, the problem media type and the document as JSON', async () => {
    const problem = problemOf('conflict', 'The name is taken');
    const response = problemResponse(problem);

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(problem);
  });

  it('asks the client to retry an unavailable server after 5 seconds, and no other problem', () => {
    const unavailable = problemResponse(problemOf('unavailable', 'The server is stopping'));
    const conflict = problemResponse(problemOf('conflict', 'The name is taken'));

    expect([unavailable.headers.get('retry-after'), conflict.headers.get('retry-after')]).toEqual(['5', null]);
  });

  it('adds the headers it is given', () => {
    const response = problemResponse(problemOf('method_not_allowed', 'Not here'), { allow: 'GET, HEAD' });

    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
