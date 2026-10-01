import type { InputForm, Registration } from '@beonauto/operations';
import { Result } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { problemOf, type Problem } from '../problem/problem.ts';
import { jsonBodyOf, type Fields } from './request-body.ts';

export interface CallInput {
  readonly input: Fields;
  readonly form: InputForm;
}

function givenTwice(name: string): Result.Result<never, Problem> {
  return Result.fail(problemOf('bad_request', `The field ${name} is given in more than one place`));
}

function queryFieldsOf(query: URLSearchParams): Result.Result<Fields, Problem> {
  const names = [...query.keys()];
  const repeated = names.find((name, position) => names.indexOf(name) !== position);
  return repeated === undefined ? Result.succeed(Object.fromEntries(query)) : givenTwice(repeated);
}

function combined(pathFields: Fields, given: Fields, form: InputForm): Result.Result<CallInput, Problem> {
  const repeated = Object.keys(given).find((name) => Object.hasOwn(pathFields, name));
  return repeated === undefined ? Result.succeed({ input: { ...given, ...pathFields }, form }) : givenTwice(repeated);
}

export async function callInputOf(
  c: Context<ApiEnv>,
  registration: Registration,
): Promise<Result.Result<CallInput, Problem>> {
  const pathFields = Object.fromEntries(registration.pathParameters.map((name) => [name, c.req.param(name)]));
  return registration.route.method === 'GET'
    ? Result.flatMap(queryFieldsOf(new URL(c.req.url).searchParams), (given) => combined(pathFields, given, 'strings'))
    : Result.flatMap(await jsonBodyOf(c.req.raw), (given) => combined(pathFields, given, 'json'));
}
