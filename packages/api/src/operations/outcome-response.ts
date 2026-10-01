import type { Rejected, Settled } from '@beonauto/operations';

import { internalErrorProblem, problemOf, problemResponse, type OptionalProblemMembers } from '../problem/problem.ts';

const serverStopping = problemOf('unavailable', 'The server is stopping');

function optionalMembersOf({ issues }: Rejected): OptionalProblemMembers {
  return issues === undefined ? {} : { errors: issues };
}

export function toHttpResponse(settled: Settled, successStatus: number): Response {
  if (settled.status === 'succeeded') {
    return Response.json(settled.output, { status: successStatus, headers: { 'cache-control': 'no-store' } });
  }
  if (settled.status === 'rejected') {
    return problemResponse(problemOf(settled.reason, settled.detail, optionalMembersOf(settled)));
  }
  if (settled.status === 'failed') {
    return problemResponse(internalErrorProblem(settled.incident));
  }
  return problemResponse(serverStopping);
}
