import { describe, expect, it } from 'vitest';

import type { RegisterRoutes } from './index.ts';
import { call, handlerWith } from './testing/api-calls.ts';

const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

const notAnError: Error = { name: 'Secret', message: 'database password is hunter2' };

const failing: RegisterRoutes = (routes) => {
  routes.add('GET', '/error', () => {
    throw new Error('database password is hunter2');
  });
  routes.add('GET', '/not-an-error', () => {
    throw notAnError;
  });
};

function internalProblemWith(incident: string | undefined): Readonly<Record<string, unknown>> {
  return {
    type: 'https://on.auto/problems/internal',
    title: 'Internal error',
    status: 500,
    detail: 'An unexpected fault occurred',
    reason: 'internal',
    incident,
  };
}

describe('an unexpected error', () => {
  it('answers 500 with only an incident id, and reports the error under that id', async () => {
    const { handler, reported } = handlerWith({ routes: [failing] });

    const answer = await call(handler, '/error');
    const [report] = reported;

    expect(answer.status).toBe(500);
    expect(report?.incident).toMatch(uuid);
    expect(answer.body).toEqual(internalProblemWith(report?.incident));
    expect(answer.text).not.toContain('hunter2');
    expect(reported).toEqual([{ incident: report?.incident, message: 'database password is hunter2' }]);
    expect(answer.headers.get('x-request-id')).toMatch(uuid);
  });
});

describe('a thrown value that is not an Error', () => {
  it('answers the same 500 problem document, and reports an Error whose cause is the value', async () => {
    const { handler, reported } = handlerWith({ routes: [failing] });

    const answer = await call(handler, '/not-an-error');
    const [report] = reported;

    expect(answer.status).toBe(500);
    expect(answer.headers.get('content-type')).toBe('application/problem+json');
    expect(report?.incident).toMatch(uuid);
    expect(answer.body).toEqual(internalProblemWith(report?.incident));
    expect(answer.text).not.toContain('hunter2');
    expect(reported).toEqual([
      { incident: report?.incident, message: 'A value that is not an Error was thrown', cause: notAnError },
    ]);
  });
});
