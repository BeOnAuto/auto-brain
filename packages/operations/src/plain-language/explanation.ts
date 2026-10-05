import type { OperationKind } from '../caller/operation-scope.ts';
import type { Cancelled, Failed, Rejected, RejectionReason } from '../outcome/outcome.ts';
import type { RejectionKind } from '../outcome/rejection.ts';
import type { UnavailableBecause } from '../outcome/unavailable.ts';

export interface Explanation {
  readonly why: string;
  readonly remedy: string;
}

export type ExplainedRejection = Pick<Rejected, 'reason' | 'kind' | 'because'>;

const correctable = 'This can be corrected and tried again; the details below say what to change.';

const explanationByReason: Readonly<Record<RejectionReason, Explanation>> = {
  invalid_input: { why: 'what was given does not fit what it needs', remedy: correctable },
  unavailable: {
    why: 'something the server relies on is not available right now',
    remedy: [
      'Only whoever runs the server can put this right, so there is nothing to change on your side;',
      'once they have, it can be tried again. Meanwhile, everything that does not need it still works.',
    ].join(' '),
  },
  not_found: {
    why: 'it, or something it refers to, could not be found',
    remedy: 'Check the names used; the details below say what is missing.',
  },
  forbidden: {
    why: 'this connection is not allowed to do that',
    remedy: 'Whoever set up this connection can allow it.',
  },
  conflict: {
    why: 'it clashes with something already there',
    remedy: 'The details below say what is in the way.',
  },
};

const explanationByKind: Readonly<Record<RejectionKind, Explanation>> = {
  taken: { why: 'that name is already taken', remedy: 'A different name will work.' },
  retired: {
    why: 'it has been retired',
    remedy: 'What is retired stays retired; a new one can be made under another name.',
  },
  concurrent_change: { why: 'something else changed it at the same moment', remedy: 'Trying again should work.' },
  unworkable: { why: 'it cannot work as it is written', remedy: correctable },
  model_not_offered: {
    why: 'this server does not offer the model named',
    remedy:
      'This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.',
  },
};

const explanationByBecause: Readonly<Record<UnavailableBecause, string>> = {
  provider_not_configured: 'because its provider is not set up on this server, though others are',
  model_not_allowed: 'because it is not among the models whoever runs the server allows',
};

export function explanationOf({ reason, kind, because }: ExplainedRejection): Explanation {
  if (kind === undefined) {
    return explanationByReason[reason];
  }
  const { why, remedy } = explanationByKind[kind];
  return because === undefined ? { why, remedy } : { why: `${why}, ${explanationByBecause[because]}`, remedy };
}

function rejectionWords(attempt: string, operationKind: OperationKind, rejection: Rejected): string {
  const { why, remedy } = explanationOf(rejection);
  const unchanged = operationKind === 'command' ? ' Nothing was changed.' : '';
  return `Could not ${attempt}: ${why}.${unchanged} ${remedy}`;
}

function failureWords(attempt: string, { incident }: Failed): string {
  return [
    `Could not ${attempt}: something went wrong inside the server.`,
    'It was not caused by anything you did.',
    `If it happens again, whoever runs the server can look into it with this reference: ${incident}.`,
  ].join(' ');
}

function cancellationWords(attempt: string, kind: OperationKind): string {
  const next =
    kind === 'command'
      ? 'It may or may not have taken effect, so check before trying again.'
      : 'It can be tried again once the server is back.';
  return `Could not ${attempt}: the server stopped before it finished. ${next}`;
}

export function unsuccessfulWords(
  attempt: string,
  kind: OperationKind,
  outcome: Rejected | Failed | Cancelled,
): string {
  if (outcome.status === 'rejected') {
    return rejectionWords(attempt, kind, outcome);
  }
  return outcome.status === 'failed' ? failureWords(attempt, outcome) : cancellationWords(attempt, kind);
}
