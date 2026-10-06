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

  it('describes a run that called tools and could not finish with a type of its own, and any other kind by its reason', () => {
    expect(problemOf('unavailable', 'It stopped', { kind: 'tools_unfinished', because: 'server_failed' })).toEqual({
      type: 'https://on.auto/problems/tools_unfinished',
      title: 'Tools unfinished',
      status: 503,
      detail: 'It stopped',
      reason: 'unavailable',
      kind: 'tools_unfinished',
      because: 'server_failed',
    });
    expect(problemOf('conflict', 'Called before', { kind: 'tools_called' })).toEqual({
      type: 'https://on.auto/problems/tools_called',
      title: 'Tools called',
      status: 409,
      detail: 'Called before',
      reason: 'conflict',
      kind: 'tools_called',
    });
    expect(problemOf('unavailable', 'Not offered', { kind: 'tool_not_offered' })).toMatchObject({
      type: 'https://on.auto/problems/unavailable',
      title: 'Unavailable',
    });
  });

  it('carries the issues that point at invalid input', () => {
    const errors = [{ detail: 'Expected a string', pointer: '/name' }];

    expect(problemOf('invalid_input', 'The input is invalid', { errors })).toMatchObject({ errors });
  });
});

function retryAfterOf(members: Parameters<typeof problemOf>[2]): string | null {
  return problemResponse(problemOf('unavailable', 'It cannot run', members)).headers.get('retry-after');
}

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

  it('asks for no retry of a run that called tools, which the same request answers with tools_called', () => {
    expect(retryAfterOf({ kind: 'tools_unfinished', because: 'model_unavailable' })).toBeNull();
  });

  it('asks for no retry of a tool or a model not offered, which only a change of the function or the configuration resolves', () => {
    expect([
      retryAfterOf({ kind: 'tool_not_offered', because: 'tool_not_allowed' }),
      retryAfterOf({ kind: 'model_not_offered', because: 'model_not_allowed' }),
      retryAfterOf({ kind: 'model_not_offered', because: 'provider_not_configured' }),
    ]).toEqual([null, null, null]);
  });

  it('asks for a retry of a tool server that could not be used, which a retry may find working', () => {
    expect(retryAfterOf({ kind: 'mcp_server_failed', because: 'unreachable' })).toBe('5');
  });

  it('adds the headers it is given', () => {
    const response = problemResponse(problemOf('method_not_allowed', 'Not here'), { allow: 'GET, HEAD' });

    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
