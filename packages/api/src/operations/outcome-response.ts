import type { Rejected, Settled } from '@beonauto/operations';

import { internalErrorProblem, problemOf, problemResponse, type OptionalProblemMembers } from '../problem/problem.ts';

const serverStopping = problemOf('unavailable', 'The server is stopping');

const clientClosed = problemOf('client_closed_request', 'The client closed the request before it was answered');

const insufficientScope = { 'www-authenticate': 'Bearer error="insufficient_scope"' };

function optionalMembersOf({ issues }: Rejected): OptionalProblemMembers {
  return issues === undefined ? {} : { errors: issues };
}

export function toHttpResponse(settled: Settled, successStatus: number, clientClosedRequest: boolean): Response {
  if (settled.status === 'succeeded') {
    return Response.json(settled.output, { status: successStatus, headers: { 'cache-control': 'no-store' } });
  }
  if (settled.status === 'rejected') {
    return problemResponse(
      problemOf(settled.reason, settled.detail, optionalMembersOf(settled)),
      settled.reason === 'forbidden' ? insufficientScope : {},
    );
  }
  if (settled.status === 'failed') {
    return problemResponse(internalErrorProblem(settled.incident));
  }
  return problemResponse(clientClosedRequest ? clientClosed : serverStopping);
}
