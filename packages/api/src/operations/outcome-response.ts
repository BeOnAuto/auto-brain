import type { Refused, Settled } from '@beonauto/operations';

import { problemOf, problemResponse, type ProblemExtensions } from '../problem/problem.ts';

const stopping = problemOf('unavailable', 'The server is stopping');

function extensionsOf({ issues }: Refused): ProblemExtensions {
  return issues === undefined ? {} : { errors: issues };
}

export function responseTo(settled: Settled, successStatus: number): Response {
  if (settled.status === 'done') {
    return Response.json(settled.output, { status: successStatus, headers: { 'cache-control': 'no-store' } });
  }
  if (settled.status === 'refused') {
    return problemResponse(problemOf(settled.reason, settled.detail, extensionsOf(settled)));
  }
  if (settled.status === 'faulted') {
    return problemResponse(problemOf('internal', 'An unexpected fault occurred', { incident: settled.incident }));
  }
  return problemResponse(stopping);
}
