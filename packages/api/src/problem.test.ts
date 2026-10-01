import { describe, expect, it } from 'vitest';

import { problemOf, problemResponse, type ProblemReason } from './index.ts';

const statusAndTitleByReason: ReadonlyArray<readonly [ProblemReason, number, string]> = [
  ['invalid_input', 422, 'Invalid input'],
  ['forbidden', 403, 'Forbidden'],
  ['not_found', 404, 'Not found'],
  ['conflict', 409, 'Conflict'],
  ['unavailable', 503, 'Unavailable'],
  ['malformed_request', 400, 'Malformed request'],
  ['unauthenticated', 401, 'Unauthenticated'],
  ['origin_not_allowed', 403, 'Origin not allowed'],
  ['method_not_allowed', 405, 'Method not allowed'],
  ['payload_too_large', 413, 'Payload too large'],
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

  it('carries an incident id', () => {
    expect(problemOf('internal', 'An unexpected fault occurred', { incident: 'incident-1' })).toMatchObject({
      incident: 'incident-1',
    });
  });
});

describe('problemResponse', () => {
  it('answers with the problem status, the problem media type and the document as JSON', async () => {
    const problem = problemOf('conflict', 'The name is taken');
    const response = problemResponse(problem);

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toEqual(problem);
  });

  it('adds the headers it is given', () => {
    const response = problemResponse(problemOf('method_not_allowed', 'Not here'), { allow: 'GET, HEAD' });

    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
