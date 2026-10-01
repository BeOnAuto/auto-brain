import { randomUUIDv7 } from 'node:crypto';

import { internalErrorProblem, problemResponse, type Problem } from './problem.ts';

export type ReportIncident = (incident: string, error: Readonly<Error>, requestId: string) => void;

export type ReportThrown = (thrown: unknown, requestId: string) => Problem;

export function problemOfThrown(reportIncident: ReportIncident): ReportThrown {
  return (thrown, requestId) => {
    const incident = randomUUIDv7();
    reportIncident(incident, asError(thrown), requestId);
    return internalErrorProblem(incident);
  };
}

export function errorHandler(reportIncident: ReportIncident): (thrown: unknown, requestId: string) => Response {
  const reportThrown = problemOfThrown(reportIncident);
  return (thrown, requestId) => problemResponse(reportThrown(thrown, requestId));
}

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error('A value that is not an Error was thrown', { cause: thrown });
}
