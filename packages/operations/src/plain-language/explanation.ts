import type { OperationKind } from '../caller/operation-scope.ts';
import type { Cancelled, Failed, Rejected, RejectionReason } from '../outcome/outcome.ts';
import type { RejectionKind } from '../outcome/rejection.ts';
import type { UnavailableBecause } from '../outcome/unavailable.ts';

export interface Explanation {
  readonly why: string;
  readonly remedy: string;
  readonly mayHaveChanged?: true;
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
  tools_called: {
    why: 'an earlier attempt of this run called tools and did not succeed, and those tools may have changed something',
    remedy: 'Start a new run instead; the history of this one shows what it called.',
  },
  model_not_offered: {
    why: 'this server does not offer the model named',
    remedy:
      'This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.',
  },
  tool_not_offered: {
    why: 'this server does not offer a tool it names',
    remedy:
      'This can be put right on your side: once it names only tools this server offers, which list_tools shows, it can be tried again.',
  },
  mcp_server_failed: {
    why: 'a tool server it needs could not be used',
    remedy:
      'Nothing was called through it, so it can be tried again later; if it keeps happening, whoever runs the server can look into that tool server.',
  },
  tools_unfinished: {
    why: 'it called tools but could not finish',
    remedy:
      'What it called may have changed something, so it is not run again by itself: check what its history shows it called, then start a new run if it is still needed.',
    mayHaveChanged: true,
  },
};

const explanationByBecause: Readonly<Record<UnavailableBecause, string>> = {
  provider_not_configured: 'because its provider is not set up on this server, though others are',
  model_not_allowed: 'because it is not among the models whoever runs the server allows',
  mcp_server_not_configured: 'because a tool server it names is not set up for this brain',
  tool_not_allowed: 'because it is not among the tools whoever runs the server allows',
  tool_not_listed: 'because the tool server it names does not have that tool',
  failing: 'because the tool server kept failing',
  rate_limited: 'because the tool server asked it to slow down for longer than a run waits',
  unreachable: 'because the tool server could not be reached in time',
  server_failed: 'because a tool server kept failing',
  model_unavailable: 'because the model stopped answering',
  run_bound: 'because it ran out of time',
  no_answer: 'because the model kept calling tools instead of answering',
};

export function explanationOf({ reason, kind, because }: ExplainedRejection): Explanation {
  if (kind === undefined) {
    return explanationByReason[reason];
  }
  const explanation = explanationByKind[kind];
  return because === undefined
    ? explanation
    : { ...explanation, why: `${explanation.why}, ${explanationByBecause[because]}` };
}

function rejectionWords(attempt: string, operationKind: OperationKind, rejection: Rejected): string {
  const { why, remedy, mayHaveChanged } = explanationOf(rejection);
  const unchanged = operationKind === 'command' && mayHaveChanged === undefined ? ' Nothing was changed.' : '';
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
