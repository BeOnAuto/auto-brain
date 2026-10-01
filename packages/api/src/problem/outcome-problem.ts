import type { Cancelled, Failed, Rejected } from '@beonauto/operations';

import { internalErrorProblem, problemOf, type OptionalProblemMembers, type Problem } from './problem.ts';

export type Unsuccessful = Rejected | Failed | Cancelled;

const serverStopping = problemOf('unavailable', 'The server is stopping');

const clientClosed = problemOf('client_closed_request', 'The client closed the request before it was answered');

function optionalMembersOf({ issues }: Rejected): OptionalProblemMembers {
  return issues === undefined ? {} : { errors: issues };
}

export function problemOfOutcome(outcome: Unsuccessful, clientClosedRequest: boolean): Problem {
  if (outcome.status === 'rejected') {
    return problemOf(outcome.reason, outcome.detail, optionalMembersOf(outcome));
  }
  if (outcome.status === 'failed') {
    return internalErrorProblem(outcome.incident);
  }
  return clientClosedRequest ? clientClosed : serverStopping;
}
