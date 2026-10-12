import {
  settle,
  type Catalog,
  type Dispatcher,
  type DispatcherServices,
  type Outcome,
  type RouteRegistration,
  type Settled,
  type Succeeded,
} from '@beonauto/operations';
import { Effect, Result } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { ReportThrown } from '../problem/error-boundary.ts';
import { problemResponse } from '../problem/problem.ts';
import type { RegisterRoutes, RouteHandler } from '../routes.ts';
import { parseCallInput, type CallInput } from './call-input.ts';
import { toHttpResponse } from './outcome-response.ts';
import { routeTableOf } from './route-table.ts';

export type RunCall = <S extends Succeeded>(
  call: Effect.Effect<Settled<S>, never, DispatcherServices>,
) => Promise<Settled<S>>;

export interface OperationRoutesOptions {
  readonly catalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly runCall: RunCall;
}

function dispatched(
  dispatcher: Dispatcher,
  registration: RouteRegistration,
  c: Context<ApiEnv>,
  given: CallInput,
): Effect.Effect<Outcome<Succeeded>, never, DispatcherServices> {
  const org = String(c.req.param('org'));
  const caller = c.get('principal').callerIn(org);
  return registration.scope === 'org'
    ? dispatcher.dispatchToOrg(registration, { caller, org, ...given })
    : dispatcher.dispatchToBrain(registration, { caller, org, brain: String(c.req.param('brain')), ...given });
}

function handlerFor(
  registration: RouteRegistration,
  { dispatcher, runCall }: OperationRoutesOptions,
  reportThrown: ReportThrown,
): RouteHandler {
  return async (c) => {
    const given = await parseCallInput(c, registration);
    if (Result.isFailure(given)) {
      return problemResponse(given.failure);
    }
    const requestId = c.get('requestId');
    const call = settle(dispatched(dispatcher, registration, c, given.success), c.req.raw.signal);
    const settled = await runCall(call.pipe(Effect.annotateLogs({ requestId })));
    return toHttpResponse(settled, {
      status: registration.successStatus,
      clientClosedRequest: c.req.raw.signal.aborted,
      failed: (thrown) => reportThrown(thrown, requestId),
      abortConnection: c.env.abortConnection,
    });
  };
}

export function operationRoutes(options: OperationRoutesOptions): RegisterRoutes {
  const table = routeTableOf(options.catalog);
  return (routes) => {
    for (const { registration, path } of table) {
      routes.add(registration.route.method, path, handlerFor(registration, options, routes.reportThrown));
    }
  };
}
