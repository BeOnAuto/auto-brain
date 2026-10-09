import { describe, expect, it } from 'vitest';

import { explanationOf, unsuccessfulWords, type ExplainedRejection, type Remedies } from '../index.ts';

const toolsNamed =
  'This can be put right on your side: whoever runs the server decides which tool servers and tools this brain may use, which list_tool_servers shows, so once it names only those, it can be tried again.';

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
    'a tool its server may let change something, which whoever runs the server has not listed as safe to test',
    { reason: 'unavailable', kind: 'tool_not_offered', because: 'not_testable' },
    "this server does not offer a tool it names, because by its server's own account it may change something, and whoever runs the server has not listed it as safe to test",
    "A tool that may change something is called only by a function the person asked to run; whoever runs the server can mark it testable on its tool server's entry, and list_tool_servers shows which tools can be tested.",
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
    'a tool server that did not accept its key',
    { reason: 'unavailable', kind: 'mcp_server_failed', because: 'key_refused' },
    'a tool server it needs could not be used, because the tool server did not accept the key this server gives it',
    'Trying again will not help until whoever runs the server checks the key it gives that tool server.',
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

describe('explanationOf a run that needs tools', () => {
  it.each(toolEndings)('explains %s', (_case, rejection, why, remedy) => {
    expect(explanationOf(rejection)).toMatchObject({ why, remedy });
  });

  it('says in 214 characters where whoever runs the server marks a tool testable', () => {
    const { remedy } = explanationOf({ reason: 'unavailable', kind: 'tool_not_offered', because: 'not_testable' });

    expect(remedy).toContain("whoever runs the server can mark it testable on its tool server's entry");
    expect(remedy).toHaveLength(214);
  });

  it('says only of tool calls that could not finish that something may have changed', () => {
    const changing = toolEndings.filter(([, rejection]) => explanationOf(rejection).mayHaveChanged === true);

    expect(changing.map(([, rejection]) => rejection.kind)).toEqual(
      Array.from({ length: 4 }, () => 'tools_unfinished'),
    );
  });
});

const serverNamed = 'list_tool_servers shows the tool servers this brain may use.';

const ownRemedies: Remedies = { mcp_server_not_configured: serverNamed };

const notConfigured = {
  status: 'rejected',
  reason: 'unavailable',
  detail: 'x',
  kind: 'tool_not_offered',
  because: 'mcp_server_not_configured',
} as const;

describe('the remedies an operation gives of its own', () => {
  it('take the place of the shared remedy for their because, and leave it for any other', () => {
    expect(explanationOf(notConfigured, ownRemedies).remedy).toBe(serverNamed);
    expect(explanationOf({ ...notConfigured, because: 'tool_not_listed' }, ownRemedies).remedy).toBe(toolsNamed);
    expect(explanationOf(notConfigured).remedy).toBe(toolsNamed);
  });

  it('end the words of a refusal for their because', () => {
    expect(unsuccessfulWords('test the tool', 'command', notConfigured, ownRemedies)).toBe(
      `Could not test the tool: this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this brain. Nothing was changed. ${serverNamed}`,
    );
  });
});
