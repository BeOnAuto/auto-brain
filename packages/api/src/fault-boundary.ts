import { randomUUID } from 'node:crypto';

import type { ReportIncident } from './api-options.ts';
import { problemOf, problemResponse } from './problem.ts';

export function answerFaults(reportIncident: ReportIncident): (thrown: unknown) => Response {
  return (thrown: unknown) => {
    const incident = randomUUID();
    reportIncident(incident, asError(thrown));
    return problemResponse(problemOf('internal', 'An unexpected fault occurred', { incident }));
  };
}

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error('A value that is not an Error was thrown', { cause: thrown });
}
