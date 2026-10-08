import { unsuccessfulWords, type UnavailableBecause } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineTestToolCall } from '../index.ts';

const { registration } = defineTestToolCall({
  open: () => Effect.die(new Error('A test of the words opens nothing')),
  testing: { allowed: null, testable: [] },
});

const words = registration.plainLanguage;

const asked = { server: 'graph', tool: 'search' };

const answer = {
  test_id: '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b',
  server: 'graph',
  tool: 'search',
  outcome: 'result',
  text: 'Found 2 rows.',
  result_bytes: 1204,
  duration_ms: 312,
  tested_at: '2026-10-08T09:00:00.000Z',
};

describe('the plain words of test_tool_call', () => {
  it('say which tool of which server it tried to test, or what it tried when the input does not hold', () => {
    expect(words?.attempt({ server: 'graph', tool: 'search' })).toBe('test the tool “search” of “graph”');
    expect(words?.attempt({ server: 'Graph/', tool: 'search' })).toBe('test a tool of a tool server');
  });

  it('say what the tool answered, how long it took and how much, and where the model’s view of it is', () => {
    expect(words?.outcome(answer, asked)).toBe(
      "The tool “search” of “graph” answered in 312 ms with 1,204 bytes; what a reasoning function's model would see is in the details.",
    );
    expect(words?.outcome({ ...answer, result_bytes: null }, asked)).toBe(
      "The tool “search” of “graph” answered in 312 ms with nothing; what a reasoning function's model would see is in the details.",
    );
  });

  it('say that the tool answered an error, that its server failed, or that it did not answer in time', () => {
    const toolError = { ...answer, outcome: 'tool_error', text: 'The field salary is denied.' };
    const serverFailure = {
      ...answer,
      outcome: 'server_failure',
      text: 'The MCP server graph failed: The MCP server answered HTTP 503',
      result_bytes: null,
    };
    const timedOut = { ...answer, outcome: 'timed_out', result_bytes: null };

    expect(words?.outcome(toolError, asked)).toBe(
      "The tool “search” of “graph” answered an error, as a run's model would see it; the details show what it said.",
    );
    expect(words?.outcome(serverFailure, asked)).toBe(
      'The tool server “graph” failed to answer the test: The MCP server answered HTTP 503. It may or may not have received the call.',
    );
    expect(words?.outcome(timedOut, asked)).toBe(
      'The tool server “graph” did not answer the test within 30 seconds; it may still have received the call.',
    );
  });

  it('end the words of a failure once, whether the server ended them or not', () => {
    const failed = { ...answer, outcome: 'server_failure', text: 'The MCP server graph failed: Gone away.' };

    expect(words?.outcome(failed, asked)).toBe(
      'The tool server “graph” failed to answer the test: Gone away. It may or may not have received the call.',
    );
  });
});

const notOffered = (because: UnavailableBecause) =>
  ({ status: 'rejected', reason: 'unavailable', detail: 'x', kind: 'tool_not_offered', because }) as const;

const remedies: ReadonlyArray<readonly [UnavailableBecause, string]> = [
  [
    'mcp_server_not_configured',
    'This can be put right on your side: list_tool_servers shows the tool servers this brain may use, so a test that names one of those can be tried.',
  ],
  [
    'tool_not_allowed',
    'This can be put right on your side: list_tool_servers shows the tools this brain may use, which whoever runs the server allows, so a test that names one of those can be tried.',
  ],
  [
    'tool_not_listed',
    'This can be put right on your side: list_tool_servers shows the tools each tool server has, so a test that names one of those can be tried.',
  ],
];

describe('the plain words of a test refused a tool it is not offered', () => {
  it.each(remedies)(
    'end, for %s, with what list_tool_servers shows, in place of the words for a function',
    (because, remedy) => {
      const refused = unsuccessfulWords(
        'test the tool “search” of “wiki”',
        'command',
        notOffered(because),
        words?.remedies,
      );

      expect(refused.endsWith(` Nothing was changed. ${remedy}`)).toBe(true);
      expect(refused).not.toContain('once it names only those');
    },
  );

  it('say why and what to do in one message for a tool server not set up for the brain', () => {
    expect(
      unsuccessfulWords(
        'test the tool “search” of “wiki”',
        'command',
        notOffered('mcp_server_not_configured'),
        words?.remedies,
      ),
    ).toBe(
      'Could not test the tool “search” of “wiki”: this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this brain. Nothing was changed. This can be put right on your side: list_tool_servers shows the tool servers this brain may use, so a test that names one of those can be tried.',
    );
  });
});
