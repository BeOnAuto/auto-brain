import type { Settled, StreamedContent } from '@beonauto/operations';

import { problemOfOutcome } from '../problem/outcome-problem.ts';
import { problemResponse } from '../problem/problem.ts';

const insufficientScope = { 'www-authenticate': 'Bearer error="insufficient_scope"' };

function streamedResponse({ stream, bytes, mediaType }: StreamedContent, status: number): Response {
  return new Response(stream, {
    status,
    headers: { 'content-type': mediaType, 'content-length': String(bytes), 'cache-control': 'no-store' },
  });
}

export function toHttpResponse(settled: Settled, successStatus: number, clientClosedRequest: boolean): Response {
  if (settled.status === 'succeeded') {
    return settled.streamed === undefined
      ? Response.json(settled.output, { status: successStatus, headers: { 'cache-control': 'no-store' } })
      : streamedResponse(settled.streamed, successStatus);
  }
  const problem = problemOfOutcome(settled, clientClosedRequest);
  return problemResponse(problem, problem.reason === 'forbidden' ? insufficientScope : {});
}
