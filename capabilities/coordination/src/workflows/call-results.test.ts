import { describe, expect, it } from 'vitest';

import type { WorkflowEnding } from '../testing/endings.ts';
import type { DefinitionCallResult } from '../testing/run-terms.ts';
import { interpret, workflow } from '../testing/workflows.ts';

const calling = workflow(`
do:
  - lookup:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        as: failure
        do:
          - report:
              set: '\${ $failure }'
`);

async function caughtFor(respond: () => DefinitionCallResult | Promise<DefinitionCallResult>): Promise<WorkflowEnding> {
  return (await interpret(calling, { respond })).ending;
}

const types = 'https://open-workflow-specification.org/spec/1.0.0/errors';

function unreachable(): Promise<DefinitionCallResult> {
  return Promise.reject(new Error('The call was lost', { cause: new Error('the host is gone') }));
}

describe('a rejected run', () => {
  it.each([
    ['invalid_input', 'validation', 400],
    ['forbidden', 'authorization', 403],
    ['not_found', 'configuration', 404],
    ['conflict', 'runtime', 409],
    ['unavailable', 'communication', 503],
    ['unheard_of', 'runtime', 500],
  ])('with %s is a %s error of status %d the document can catch', async (reason, kind, status) => {
    expect(await caughtFor(() => ({ status: 'rejected', reason, detail: 'The model is busy' }))).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/${kind}`,
        status,
        instance: '/do/0/lookup/try/0/fetch',
        title: `The reasoning function lookup rejected the run with ${reason}`,
        detail: 'The model is busy',
      },
    });
  });
});

const branching = workflow(`
do:
  - lookup:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        when: '\${ $error.kind == "tool_not_offered" and $error.because == "tool_not_allowed" }'
        do:
          - report:
              set: { offered: false }
`);

function rejectedAs(kind: string): () => DefinitionCallResult {
  return () => ({ status: 'rejected', reason: 'unavailable', detail: 'No', kind, because: 'tool_not_allowed' });
}

describe('a rejected run that names its kind and because', () => {
  it('is an error the document can catch and branch on by its kind and because', async () => {
    const rejected = {
      status: 'rejected',
      reason: 'unavailable',
      detail: 'A tool server kept failing, after the run called the search tool of graph',
      kind: 'tools_unfinished',
      because: 'server_failed',
    } as const;

    expect(await caughtFor(() => rejected)).toEqual({
      kind: 'completed',
      output: {
        type: 'https://on.auto/problems/tools_unfinished',
        status: 503,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'The reasoning function lookup rejected the run with unavailable',
        detail: rejected.detail,
        kind: 'tools_unfinished',
        because: 'server_failed',
      },
    });
  });

  it('is caught by a condition on its kind, and passed on by one on another kind', async () => {
    expect((await interpret(branching, { respond: rejectedAs('tool_not_offered') })).ending).toEqual({
      kind: 'completed',
      output: { offered: false },
    });
    expect((await interpret(branching, { respond: rejectedAs('mcp_server_failed') })).ending).toEqual({
      kind: 'failed',
      type: 'UncaughtError',
      message: 'The reasoning function lookup rejected the run with unavailable: No (at /do/0/lookup/try/0/fetch)',
    });
  });
});

const retryingCommunication = workflow(`
do:
  - lookup:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        errors:
          with: { type: https://open-workflow-specification.org/spec/1.0.0/errors/communication }
        retry: { delay: PT1S, limit: { attempt: { count: 3 } } }
`);

describe('a run of a function that called tools and could not finish', () => {
  it('is not caught by a retry of communication errors, so its tools never run again under another id', async () => {
    const calls: string[] = [];
    const { ending } = await interpret(retryingCommunication, {
      respond: ({ run }) => {
        calls.push(`run ${run}`);
        return { status: 'rejected', reason: 'unavailable', detail: 'It stopped', kind: 'tools_unfinished' };
      },
    });

    expect(ending).toEqual({
      kind: 'failed',
      type: 'UncaughtError',
      message:
        'The reasoning function lookup rejected the run with unavailable: It stopped (at /do/0/lookup/try/0/fetch)',
    });
    expect(calls).toEqual(['run 1']);
  });
});

const retryingRuntime = workflow(`
do:
  - lookup:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        errors:
          with: { type: https://open-workflow-specification.org/spec/1.0.0/errors/runtime }
        retry: { delay: PT1S, limit: { attempt: { count: 3 } } }
`);

describe('a step that meets a run whose tools may have been called', () => {
  it('is not retried by a retry of runtime errors, and ends the run as a conflict of tools called', async () => {
    const calls: string[] = [];
    const { ending, settlement } = await interpret(retryingRuntime, {
      respond: ({ run }) => {
        calls.push(`run ${run}`);
        return { status: 'rejected', reason: 'conflict', detail: 'It may have called tools', kind: 'tools_called' };
      },
    });

    expect(calls).toEqual(['run 1']);
    expect(ending).toMatchObject({ kind: 'failed', type: 'UncaughtError' });
    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The reasoning function lookup rejected the run with conflict: It may have called tools (at /do/0/lookup/try/0/fetch)',
      kind: 'tools_called',
    });
  });
});

describe('a failed run', () => {
  it('is a runtime error', async () => {
    expect(await caughtFor(() => ({ status: 'failed', detail: 'It failed with incident 7' }))).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/runtime`,
        status: 500,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'The reasoning function lookup failed',
        detail: 'It failed with incident 7',
      },
    });
  });

  it('is a communication error when the run could not be reached, with the chain of causes', async () => {
    expect(await caughtFor(unreachable)).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/communication`,
        status: 503,
        instance: '/do/0/lookup/try/0/fetch',
        title: 'run_definition could not reach the reasoning function lookup',
        detail: 'Error: The call was lost: Error: the host is gone',
      },
    });
  });
});
