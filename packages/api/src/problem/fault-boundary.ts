import { randomUUIDv7 } from 'node:crypto';

import { internalErrorProblem, problemResponse } from './problem.ts';

export type ReportIncident = (incident: string, error: Readonly<Error>) => void;

export function answerFaults(reportIncident: ReportIncident): (thrown: unknown) => Response {
  return (thrown: unknown) => {
    const incident = randomUUIDv7();
    reportIncident(incident, asError(thrown));
    return problemResponse(internalErrorProblem(incident));
  };
}

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error('A value that is not an Error was thrown', { cause: thrown });
}
