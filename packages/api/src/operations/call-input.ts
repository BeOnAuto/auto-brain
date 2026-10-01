import type { InputEncoding, Registration } from '@beonauto/operations';
import { Result } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { problemOf, type Problem } from '../problem/problem.ts';
import { parseJsonBody, type JsonObject } from './request-body.ts';

export interface CallInput {
  readonly input: JsonObject;
  readonly encoding: InputEncoding;
}

const queryOnCommand = Result.fail(
  problemOf('bad_request', 'A command takes no query parameters; send its input in the JSON body'),
);

function givenTwice(name: string): Result.Result<never, Problem> {
  return Result.fail(problemOf('bad_request', `The field ${name} is given in more than one place`));
}

function queryFieldsOf(query: URLSearchParams): Result.Result<JsonObject, Problem> {
  const names = [...query.keys()];
  const repeated = names.find((name, position) => names.indexOf(name) !== position);
  return repeated === undefined ? Result.succeed(Object.fromEntries(query)) : givenTwice(repeated);
}

function combined(
  pathFields: JsonObject,
  given: JsonObject,
  encoding: InputEncoding,
): Result.Result<CallInput, Problem> {
  const repeated = Object.keys(given).find((name) => Object.hasOwn(pathFields, name));
  return repeated === undefined
    ? Result.succeed({ input: { ...given, ...pathFields }, encoding })
    : givenTwice(repeated);
}

export async function parseCallInput(
  c: Context<ApiEnv>,
  registration: Registration,
): Promise<Result.Result<CallInput, Problem>> {
  const pathFields = Object.fromEntries(registration.pathParameters.map((name) => [name, c.req.param(name)]));
  const query = new URL(c.req.url).searchParams;
  if (registration.route.method === 'GET') {
    return Result.flatMap(queryFieldsOf(query), (given) => combined(pathFields, given, 'strings'));
  }
  if (query.size > 0) {
    return queryOnCommand;
  }
  return Result.flatMap(await parseJsonBody(c.req.raw), (given) => combined(pathFields, given, 'json'));
}
