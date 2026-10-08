import type { OperationKind } from '../caller/operation-scope.ts';
import type { Cancelled, Failed, Rejected, RejectionReason } from '../outcome/outcome.ts';
import type { RejectionKind } from '../outcome/rejection.ts';
import type { UnavailableBecause } from '../outcome/unavailable.ts';
import type { Remedies } from './plain-language.ts';

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
  cancelled: {
    why: 'it was cancelled before it finished',
    remedy: 'Nothing more of it runs; start a new run if it is still needed.',
    mayHaveChanged: true,
  },
  unanswered: {
    why: 'nobody answered what it asked',
    remedy: 'Nothing more of it runs; asking again is a new run, which can be started if an answer is still needed.',
    mayHaveChanged: true,
  },
};

const ranUntilCancelled =
  'Nothing more of it runs, but what it did before may have changed something; start a new run if it is still needed.';

const explanationByKind: Readonly<Record<RejectionKind, Explanation>> = {
  taken: { why: 'that name is already taken', remedy: 'A different name will work.' },
  retired: {
    why: 'it has been retired',
    remedy: 'What is retired stays retired; a new one can be made under another name.',
  },
  concurrent_change: { why: 'something else changed it at the same moment', remedy: 'Trying again should work.' },
  unworkable: { why: 'it cannot work as it is written', remedy: correctable },
  stalled: {
    why: 'what it keeps of the brain’s history stopped at a recorded event it could not take in',
    remedy:
      'It answers again once a corrected version is saved, which builds it anew from the history; the details below say which event stopped it and why.',
  },
  rebuilding: {
    why: 'what it keeps of the brain’s history is still being built from that history',
    remedy: 'Nothing needs to change: trying again in a little while should work.',
  },
  tools_called: {
    why: 'this run calls tools, and an attempt of it under the same id may still be in progress or did not succeed, so its tools may have changed something',
    remedy:
      'So it was not run again: start a new run instead, after checking what its history shows it has called so far.',
    mayHaveChanged: true,
  },
  model_not_offered: {
    why: 'this server does not offer the model named',
    remedy:
      'This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.',
  },
  tool_not_offered: {
    why: 'this server does not offer a tool it names',
    remedy:
      'This can be put right on your side: whoever runs the server decides which tool servers and tools this brain may use, which list_tool_servers shows, so once it names only those, it can be tried again.',
  },
  mcp_server_failed: {
    why: 'a tool server it needs could not be used',
    remedy:
      'Nothing was called through it, so it can be tried again later; if it keeps happening, whoever runs the server can look into that tool server.',
  },
  oversized: {
    why: 'its result is larger than a run may record',
    remedy:
      'This can be put right on your side: once its result keeps only what is needed, such as fewer or smaller values, it can be run again.',
  },
  requested: {
    why: 'it was cancelled at the request of someone allowed to change the brain',
    remedy: ranUntilCancelled,
    mayHaveChanged: true,
  },
  deadline: {
    why: 'the step that waited for it ran out of time, so it was cancelled',
    remedy:
      'Nothing more of it runs, but what it did before may have changed something; the step that waited for it decides what happens next.',
    mayHaveChanged: true,
  },
  overrun: {
    why: 'it ran for as long as a workflow may run, so it was stopped',
    remedy:
      'Whoever runs the server decides how long a workflow may run; what it did before may have changed something, so check before starting a new run.',
    mayHaveChanged: true,
  },
  parent_ended: {
    why: 'the run that waited for it ended first, so it was cancelled',
    remedy: 'Nothing more of it runs, since only that run needed it; what it did before may have changed something.',
    mayHaveChanged: true,
  },
  expired: {
    why: 'nobody answered what it asked before the request expired',
    remedy:
      'Nothing more of it runs, though the request may have reached someone; asking again is a new run, which can be started, with more time if needed.',
    mayHaveChanged: true,
  },
  undelivered: {
    why: 'what it had to send could not be delivered, though every attempt was made',
    remedy:
      'Nothing more of it runs; whoever runs the server can look into the channel it names, and then a new run can send it again.',
    mayHaveChanged: true,
  },
  channel_not_offered: {
    why: 'this server does not offer the channel it names',
    remedy:
      'This can be put right on your side: whoever runs the server decides which channels this brain may use, so once it names one of those, it can be tried again.',
  },
  requests_full: {
    why: 'the brain already holds as many open requests as it may',
    remedy: 'Once some of them are answered, expire or are cancelled, it can be tried again.',
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
  mcp_server_not_configured: 'because whoever runs the server has not set up a tool server of that name for this brain',
  tool_not_allowed: 'because it is not among the tools whoever runs the server allows',
  tool_not_listed: 'because the tool server it names does not have that tool',
  not_testable:
    "because by its server's own account it may change something, and whoever runs the server has not listed it as safe to test",
  failing: 'because the tool server kept failing',
  rate_limited: 'because the tool server asked it to slow down for longer than a run waits',
  unreachable: 'because the tool server could not be reached in time',
  key_refused: 'because the tool server did not accept the key this server gives it',
  server_failed: 'because a tool server kept failing',
  model_unavailable: 'because the model stopped answering',
  run_bound: 'because it ran out of time',
  no_answer: 'because the model kept calling tools instead of answering',
};

const remedyByBecause: Remedies = {
  not_testable:
    "A tool that may change something is called only by a function the person asked to run; whoever runs the server can mark it testable on its tool server's entry, and list_tool_servers shows which tools can be tested.",
  key_refused: 'Trying again will not help until whoever runs the server checks the key it gives that tool server.',
};

const noRemedies: Remedies = {};

export function explanationOf(
  { reason, kind, because }: ExplainedRejection,
  remedies: Remedies = noRemedies,
): Explanation {
  if (kind === undefined) {
    return explanationByReason[reason];
  }
  const explanation = explanationByKind[kind];
  return because === undefined
    ? explanation
    : {
        ...explanation,
        why: `${explanation.why}, ${explanationByBecause[because]}`,
        remedy: remedies[because] ?? remedyByBecause[because] ?? explanation.remedy,
      };
}

function rejectionWords(
  attempt: string,
  operationKind: OperationKind,
  rejection: Rejected,
  remedies: Remedies,
): string {
  const { why, remedy, mayHaveChanged } = explanationOf(rejection, remedies);
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
  remedies: Remedies = noRemedies,
): string {
  if (outcome.status === 'rejected') {
    return rejectionWords(attempt, kind, outcome, remedies);
  }
  return outcome.status === 'failed' ? failureWords(attempt, outcome) : cancellationWords(attempt, kind);
}
