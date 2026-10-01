import type { Settled } from '@beonauto/operations';

import { problemOfOutcome } from '../problem/outcome-problem.ts';
import { problemResponse } from '../problem/problem.ts';

const insufficientScope = { 'www-authenticate': 'Bearer error="insufficient_scope"' };

export function toHttpResponse(settled: Settled, successStatus: number, clientClosedRequest: boolean): Response {
  if (settled.status === 'succeeded') {
    return Response.json(settled.output, { status: successStatus, headers: { 'cache-control': 'no-store' } });
  }
  const problem = problemOfOutcome(settled, clientClosedRequest);
  return problemResponse(problem, problem.reason === 'forbidden' ? insufficientScope : {});
}
