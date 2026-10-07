import { describe, expect, it } from 'vitest';

import {
  explanationOf,
  rejected,
  unsuccessfulWords,
  type CancelledKind,
  type ConflictKind,
  type ExplainedRejection,
  type OperationKind,
  type RejectionReason,
} from '../index.ts';

const correctable = 'This can be corrected and tried again; the details below say what to change.';

const operator =
  'Only whoever runs the server can put this right, so there is nothing to change on your side; once they have, it can be tried again. Meanwhile, everything that does not need it still works.';

const byReason: ReadonlyArray<readonly [Exclude<RejectionReason, 'conflict'>, string, string]> = [
  ['invalid_input', 'what was given does not fit what it needs', correctable],
  ['unavailable', 'something the server relies on is not available right now', operator],
  [
    'not_found',
    'it, or something it refers to, could not be found',
    'Check the names used; the details below say what is missing.',
  ],
  ['forbidden', 'this connection is not allowed to do that', 'Whoever set up this connection can allow it.'],
];

const byConflict: ReadonlyArray<readonly [ConflictKind, string, string]> = [
  ['taken', 'that name is already taken', 'A different name will work.'],
  ['retired', 'it has been retired', 'What is retired stays retired; a new one can be made under another name.'],
  ['concurrent_change', 'something else changed it at the same moment', 'Trying again should work.'],
  ['unworkable', 'it cannot work as it is written', correctable],
  [
    'stalled',
    'what it keeps of the brain’s history stopped at a recorded event it could not take in',
    'It answers again once a corrected version is saved, which builds it anew from the history; the details below say which event stopped it and why.',
  ],
  [
    'oversized',
    'its result is larger than a run may record',
    'This can be put right on your side: once its result keeps only what is needed, such as fewer or smaller values, it can be run again.',
  ],
];

const ranUntilCancelled =
  'Nothing more of it runs, but what it did before may have changed something; start a new run if it is still needed.';

const byCancellation: ReadonlyArray<readonly [CancelledKind, string, string]> = [
  ['requested', 'it was cancelled at the request of someone allowed to change the brain', ranUntilCancelled],
  [
    'deadline',
    'the step that waited for it ran out of time, so it was cancelled',
    'Nothing more of it runs, but what it did before may have changed something; the step that waited for it decides what happens next.',
  ],
  [
    'overrun',
    'it ran for as long as a workflow may run, so it was stopped',
    'Whoever runs the server decides how long a workflow may run; what it did before may have changed something, so check before starting a new run.',
  ],
  [
    'parent_ended',
    'the run that waited for it ended first, so it was cancelled',
    'Nothing more of it runs, since only that run needed it; what it did before may have changed something.',
  ],
];

const calledToolsWords =
  'Could not run the reasoning function “summary”: this run calls tools, and an attempt of it under the same id may still be in progress or did not succeed, so its tools may have changed something. So it was not run again: start a new run instead, after checking what its history shows it has called so far.';

const toolsNamed =
  'This can be put right on your side: whoever runs the server decides which tool servers and tools this brain may use, so once it names only those, it can be tried again.';

const serverFailed =
  'Nothing was called through it, so it can be tried again later; if it keeps happening, whoever runs the server can look into that tool server.';

const toolsMayHaveWritten =
  'What it called may have changed something, so it is not run again by itself: check what its history shows it called, then start a new run if it is still needed.';

const toolEndings: ReadonlyArray<readonly [string, ExplainedRejection, string, string]> = [
  [
    'a tool server not set up for the brain',
    { reason: 'unavailable', kind: 'tool_not_offered', because: 'mcp_server_not_configured' },
    'this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this brain',
    toolsNamed,
  ],
  [
    'a tool outside what is allowed',
    { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_not_allowed' },
    'this server does not offer a tool it names, because it is not among the tools whoever runs the server allows',
    toolsNamed,
  ],
  [
    'a tool its server does not have',
    { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_not_listed' },
    'this server does not offer a tool it names, because the tool server it names does not have that tool',
    toolsNamed,
  ],
  [
    'a tool server that kept failing before any call',
    { reason: 'unavailable', kind: 'mcp_server_failed', because: 'failing' },
    'a tool server it needs could not be used, because the tool server kept failing',
    serverFailed,
  ],
  [
    'a tool server that asked to slow down',
    { reason: 'unavailable', kind: 'mcp_server_failed', because: 'rate_limited' },
    'a tool server it needs could not be used, because the tool server asked it to slow down for longer than a run waits',
    serverFailed,
  ],
  [
    'a tool server out of reach',
    { reason: 'unavailable', kind: 'mcp_server_failed', because: 'unreachable' },
    'a tool server it needs could not be used, because the tool server could not be reached in time',
    serverFailed,
  ],
  [
    'calls a failing tool server ended',
    { reason: 'unavailable', kind: 'tools_unfinished', because: 'server_failed' },
    'it called tools but could not finish, because a tool server kept failing',
    toolsMayHaveWritten,
  ],
  [
    'calls the model did not finish',
    { reason: 'unavailable', kind: 'tools_unfinished', because: 'model_unavailable' },
    'it called tools but could not finish, because the model stopped answering',
    toolsMayHaveWritten,
  ],
  [
    'calls that ran out of time',
    { reason: 'unavailable', kind: 'tools_unfinished', because: 'run_bound' },
    'it called tools but could not finish, because it ran out of time',
    toolsMayHaveWritten,
  ],
  [
    'calls that never came to an answer',
    { reason: 'unavailable', kind: 'tools_unfinished', because: 'no_answer' },
    'it called tools but could not finish, because the model kept calling tools instead of answering',
    toolsMayHaveWritten,
  ],
];

describe('the explanation of a view still being built', () => {
  it('says that trying again later should work, and that nothing needs to change', () => {
    expect(explanationOf({ reason: 'unavailable', kind: 'rebuilding' })).toEqual({
      why: 'what it keeps of the brain’s history is still being built from that history',
      remedy: 'Nothing needs to change: trying again in a little while should work.',
    });
  });
});

const switchable =
  'This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.';

const notOffered: ReadonlyArray<readonly [string, ExplainedRejection, string]> = [
  [
    'without saying why',
    { reason: 'unavailable', kind: 'model_not_offered' },
    'this server does not offer the model named',
  ],
  [
    'because its provider is not set up',
    { reason: 'unavailable', kind: 'model_not_offered', because: 'provider_not_configured' },
    'this server does not offer the model named, because its provider is not set up on this server, though others are',
  ],
  [
    'because it is not allowed',
    { reason: 'unavailable', kind: 'model_not_offered', because: 'model_not_allowed' },
    'this server does not offer the model named, because it is not among the models whoever runs the server allows',
  ],
];

const afterStopping: ReadonlyArray<readonly [OperationKind, string]> = [
  ['command', 'It may or may not have taken effect, so check before trying again.'],
  ['query', 'It can be tried again once the server is back.'],
];

describe('explanationOf', () => {
  it.each(byReason)('explains %s', (reason, why, remedy) => {
    expect(explanationOf({ reason })).toEqual({ why, remedy });
  });

  it.each(byConflict)('explains a conflict of the kind %s', (kind, why, remedy) => {
    expect(explanationOf({ reason: 'conflict', kind })).toEqual({ why, remedy });
  });

  it.each(notOffered)('explains a model the server does not offer, %s', (_case, rejection, why) => {
    expect(explanationOf(rejection)).toEqual({ why, remedy: switchable });
  });

  it.each(toolEndings)('explains %s', (_case, rejection, why, remedy) => {
    expect(explanationOf(rejection)).toMatchObject({ why, remedy });
  });

  it('says only of tool calls that could not finish that something may have changed', () => {
    const changing = toolEndings.filter(([, rejection]) => explanationOf(rejection).mayHaveChanged === true);

    expect(changing.map(([, rejection]) => rejection.kind)).toEqual(
      Array.from({ length: 4 }, () => 'tools_unfinished'),
    );
  });

  it('explains a run refused under its id, whose tools may have changed something', () => {
    expect(explanationOf({ reason: 'conflict', kind: 'tools_called' })).toEqual({
      why: 'this run calls tools, and an attempt of it under the same id may still be in progress or did not succeed, so its tools may have changed something',
      remedy:
        'So it was not run again: start a new run instead, after checking what its history shows it has called so far.',
      mayHaveChanged: true,
    });
  });

  it.each(byCancellation)(
    'explains a run cancelled with the kind %s, which may have changed something',
    (kind, why, remedy) => {
      expect(explanationOf({ reason: 'cancelled', kind })).toEqual({ why, remedy, mayHaveChanged: true });
    },
  );
});

describe('explanationOf a run that names no kind', () => {
  it('explains a cancelled run that does not say its kind', () => {
    expect(explanationOf({ reason: 'cancelled' })).toEqual({
      why: 'it was cancelled before it finished',
      remedy: 'Nothing more of it runs; start a new run if it is still needed.',
      mayHaveChanged: true,
    });
  });

  it('explains a conflict that does not say its kind', () => {
    expect(explanationOf({ reason: 'conflict' })).toEqual({
      why: 'it clashes with something already there',
      remedy: 'The details below say what is in the way.',
    });
  });
});

describe('unsuccessfulWords', () => {
  it('says what could not be done, why, that nothing changed, and what to do, for a command', () => {
    expect(
      unsuccessfulWords('create the brain “Sales”', 'command', rejected('conflict', 'x', undefined, 'taken')),
    ).toBe(
      'Could not create the brain “Sales”: that name is already taken. Nothing was changed. A different name will work.',
    );
  });

  it('does not say that nothing changed for a command whose tool calls may have changed something', () => {
    expect(
      unsuccessfulWords('run the reasoning function “summary”', 'command', {
        ...rejected('unavailable', 'x', undefined, 'tools_unfinished'),
        because: 'run_bound',
      }),
    ).toBe(
      'Could not run the reasoning function “summary”: it called tools but could not finish, because it ran out of time. What it called may have changed something, so it is not run again by itself: check what its history shows it called, then start a new run if it is still needed.',
    );
  });

  it('does not say that nothing changed for a run that was cancelled, since it may have done some of its work', () => {
    expect(
      unsuccessfulWords('run the workflow “close”', 'command', rejected('cancelled', 'x', undefined, 'deadline')),
    ).toBe(
      'Could not run the workflow “close”: the step that waited for it ran out of time, so it was cancelled. Nothing more of it runs, but what it did before may have changed something; the step that waited for it decides what happens next.',
    );
  });

  it('does not say that nothing changed for a query, which changes nothing', () => {
    expect(unsuccessfulWords('look up the brain “sales”', 'query', rejected('not_found', 'x'))).toBe(
      'Could not look up the brain “sales”: it, or something it refers to, could not be found. Check the names used; the details below say what is missing.',
    );
  });

  it('gives the reference of an unexpected failure, and says it was not the person’s doing', () => {
    expect(
      unsuccessfulWords('run the reasoning function “summary”', 'command', { status: 'failed', incident: 'abc' }),
    ).toBe(
      'Could not run the reasoning function “summary”: something went wrong inside the server. It was not caused by anything you did. If it happens again, whoever runs the server can look into it with this reference: abc.',
    );
  });

  it.each(afterStopping)('says what to do after a %s the server stopped', (kind, next) => {
    expect(unsuccessfulWords('do it', kind, { status: 'cancelled' })).toBe(
      `Could not do it: the server stopped before it finished. ${next}`,
    );
  });
});

describe('unsuccessfulWords for a run refused under its id', () => {
  it('does not say that nothing changed, since the tools of the run may have changed something', () => {
    expect(
      unsuccessfulWords(
        'run the reasoning function “summary”',
        'command',
        rejected('conflict', 'x', undefined, 'tools_called'),
      ),
    ).toBe(calledToolsWords);
  });
});
