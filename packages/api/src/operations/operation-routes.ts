import {
  callSummaryOf,
  settle,
  type CallSummary,
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

interface Dispatched {
  readonly call: Effect.Effect<Outcome<Succeeded>, never, DispatcherServices>;
  readonly summary: CallSummary;
}

function dispatched(
  dispatcher: Dispatcher,
  registration: RouteRegistration,
  c: Context<ApiEnv>,
  given: CallInput,
): Dispatched {
  const org = String(c.req.param('org'));
  const request = { caller: c.get('principal').callerIn(org), org, ...given };
  if (registration.scope === 'org') {
    return {
      call: dispatcher.dispatchToOrg(registration, request),
      summary: callSummaryOf(registration.name, request),
    };
  }
  const playbook = String(c.req.param('playbook'));
  return {
    call: dispatcher.dispatchToPlaybook(registration, { ...request, playbook }),
    summary: callSummaryOf(registration.name, request, playbook),
  };
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
    const { call, summary } = dispatched(dispatcher, registration, c, given.success);
    const settled = await runCall(settle(call, c.req.raw.signal).pipe(Effect.annotateLogs({ requestId })));
    return toHttpResponse(settled, {
      status: registration.successStatus,
      signal: c.req.raw.signal,
      failed: (thrown) => reportThrown(thrown, requestId, summary),
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
