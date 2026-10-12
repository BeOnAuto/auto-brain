import type { Settled, Succeeded } from '@beonauto/operations';

import { problemOfOutcome } from '../problem/outcome-problem.ts';
import { problemResponse } from '../problem/problem.ts';
import { streamedResponse, type StreamServing } from './streamed-response.ts';

const insufficientScope = { 'www-authenticate': 'Bearer error="insufficient_scope"' };

export function toHttpResponse(settled: Settled<Succeeded>, answering: StreamServing): Response | Promise<Response> {
  if (settled.status !== 'succeeded') {
    const problem = problemOfOutcome(settled, answering.signal.aborted);
    return problemResponse(problem, problem.reason === 'forbidden' ? insufficientScope : {});
  }
  return 'streamed' in settled
    ? streamedResponse(settled.streamed, answering)
    : Response.json(settled.output, { status: answering.status, headers: { 'cache-control': 'no-store' } });
}
