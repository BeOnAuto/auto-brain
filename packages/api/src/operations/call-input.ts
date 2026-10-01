import type { InputForm, Registration } from '@beonauto/operations';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { read, refusedWith, type Readout } from './readout.ts';
import { jsonBodyOf, type Fields } from './request-body.ts';

export interface CallInput {
  readonly input: Fields;
  readonly form: InputForm;
}

function givenTwice(name: string): Readout<never> {
  return refusedWith('malformed_request', `The field ${name} is given in more than one place`);
}

function queryFieldsOf(query: URLSearchParams): Readout<Fields> {
  const names = [...query.keys()];
  const repeated = names.find((name, position) => names.indexOf(name) !== position);
  return repeated === undefined ? read(Object.fromEntries(query)) : givenTwice(repeated);
}

function combined(pathFields: Fields, given: Readout<Fields>, form: InputForm): Readout<CallInput> {
  if (given.status === 'refused') {
    return given;
  }
  const repeated = Object.keys(given.value).find((name) => Object.hasOwn(pathFields, name));
  return repeated === undefined ? read({ input: { ...given.value, ...pathFields }, form }) : givenTwice(repeated);
}

export async function callInputOf(c: Context<ApiEnv>, registration: Registration): Promise<Readout<CallInput>> {
  const pathFields = Object.fromEntries(registration.pathParameters.map((name) => [name, c.req.param(name)]));
  return registration.route.method === 'GET'
    ? combined(pathFields, queryFieldsOf(new URL(c.req.url).searchParams), 'strings')
    : combined(pathFields, await jsonBodyOf(c.req.raw), 'json');
}
