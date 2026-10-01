import {
  settle,
  type Catalog,
  type Dispatcher,
  type DispatcherServices,
  type Outcome,
  type Registration,
  type Settled,
} from '@beonauto/operations';
import type { Effect } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { problemResponse } from '../problem/problem.ts';
import type { RegisterRoutes, RouteHandler } from '../routes.ts';
import { callInputOf, type CallInput } from './call-input.ts';
import { responseTo } from './outcome-response.ts';
import { routeTableOf } from './route-table.ts';

export type RunCall = (call: Effect.Effect<Settled, never, DispatcherServices>) => Promise<Settled>;

export interface OperationRoutesOptions {
  readonly catalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly runCall: RunCall;
}

function dispatched(
  dispatcher: Dispatcher,
  registration: Registration,
  c: Context<ApiEnv>,
  { input, form }: CallInput,
): Effect.Effect<Outcome, never, DispatcherServices> {
  const org = String(c.req.param('org'));
  const caller = c.get('principal').callerIn(org);
  return registration.scope === 'org'
    ? dispatcher.inOrg(registration, { caller, org, input, form })
    : dispatcher.inBrain(registration, { caller, org, brain: String(c.req.param('brain')), input, form });
}

function handlerFor(registration: Registration, { dispatcher, runCall }: OperationRoutesOptions): RouteHandler {
  return async (c) => {
    const given = await callInputOf(c, registration);
    if (given.status === 'refused') {
      return problemResponse(given.problem);
    }
    const settled = await runCall(settle(dispatched(dispatcher, registration, c, given.value), c.req.raw.signal));
    return responseTo(settled, registration.successStatus);
  };
}

export function operationRoutes(options: OperationRoutesOptions): RegisterRoutes {
  const table = routeTableOf(options.catalog);
  return (routes) => {
    for (const { registration, path } of table) {
      routes.add(registration.route.method, path, handlerFor(registration, options));
    }
  };
}
