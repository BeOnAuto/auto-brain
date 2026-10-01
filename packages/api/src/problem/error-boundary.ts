import { randomUUIDv7 } from 'node:crypto';

import { internalErrorProblem, problemResponse } from './problem.ts';

export type ReportIncident = (incident: string, error: Readonly<Error>, requestId: string) => void;

export function errorHandler(reportIncident: ReportIncident): (thrown: unknown, requestId: string) => Response {
  return (thrown, requestId) => {
    const incident = randomUUIDv7();
    reportIncident(incident, asError(thrown), requestId);
    return problemResponse(internalErrorProblem(incident));
  };
}

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error('A value that is not an Error was thrown', { cause: thrown });
}
