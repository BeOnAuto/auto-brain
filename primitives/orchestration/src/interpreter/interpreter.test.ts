import { describe, expect, it } from 'vitest';

import { fakeHost } from '../testing/fake-host.ts';
import { workflowStartedAt } from '../testing/virtual-clock.ts';
import { acmeCaller, executionId, interpret, runOf, workflow, onMachine } from '../testing/workflows.ts';
import { startWorkflow } from './interpreter.ts';

const greeting = workflow(`
do:
  - greet:
      set:
        greeting: \${ "Hello, " + .name }
`);

const pausing = workflow(`
do:
  - pause:
      wait: PT1H
`);

describe('a workflow run that succeeds', () => {
  it.skipIf(onMachine)(
    'runs its tasks on the input, settles the execution with the output and completes with it',
    async () => {
      const { ending, commands } = await interpret(greeting, { input: { name: 'Ada' } });

      expect(ending).toEqual({ kind: 'completed', output: { greeting: 'Hello, Ada' } });
      expect(commands).toEqual([
        { kind: 'deadline', milliseconds: 30 * 24 * 3_600_000 - 3_600_000 },
        {
          kind: 'settle',
          request: {
            org: 'acme',
            brain: 'alpha',
            spec: 'test-flow',
            executionId,
            settlement: { status: 'succeeded', output: { greeting: 'Hello, Ada' } },
          },
        },
      ]);
    },
  );

  it('carries the execution and the caller of the run', () => {
    expect(runOf(greeting)).toMatchObject({ caller: acmeCaller, execution: { id: executionId } });
  });
});

describe('the data of a workflow', () => {
  it('is shaped by input.from and output.as', async () => {
    const document = workflow(`
input:
  from: '\${ { name: .person.first } }'
do:
  - greet:
      set:
        greeting: \${ "Hello, " + .name }
output:
  as: .greeting
`);

    expect((await interpret(document, { input: { person: { first: 'Grace' } } })).ending).toEqual({
      kind: 'completed',
      output: 'Hello, Grace',
    });
  });

  it('describes the workflow and the runtime to the expressions of its input', async () => {
    const document = workflow(`
input:
  from: '\${ { id: $workflow.id, at: $workflow.startedAt.iso8601, runtime: $runtime.name } }'
do: []
`);

    expect((await interpret(document, { input: 7 })).ending).toEqual({
      kind: 'completed',
      output: { id: executionId, at: new Date(workflowStartedAt).toISOString(), runtime: 'auto-brain' },
    });
  });
});

describe('a workflow run that raises an error it does not catch', () => {
  it('is rejected as invalid input, and fails, for a client error', async () => {
    const document = workflow(`
do:
  - reject:
      raise:
        error:
          type: https://example.com/errors/no-name
          status: 422
          title: The input names no one
`);

    const { ending, settlement } = await interpret(document);

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input names no one (at /do/0/reject)',
    });
    expect(ending).toEqual({
      kind: 'failed',
      type: 'UncaughtError',
      message: 'The input names no one (at /do/0/reject)',
    });
  });

  it('rejects a document the policy forbids, even one that was never parsed', async () => {
    const document = workflow('do:\n  - shell:\n      run:\n        shell:\n          command: ls');

    expect((await interpret(document)).settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail:
        'The workflow document is not allowed by this runtime: /do/0/shell/run: run tasks (shell, script, container, workflow) are not allowed (at /)',
    });
  });
});

describe('a workflow run that cannot be read', () => {
  it('fails without settling', async () => {
    const fake = fakeHost();
    const start = startWorkflow({ document: 'nothing' }, fake.host);
    start.deliver({ id: 'e1', type: 'ignored' });

    expect(await fake.drive(() => start.ending)).toEqual({
      kind: 'faulted',
      type: 'InvalidRun',
      message: 'The workflow was started without a run it can read',
    });
    expect(fake.commands()).toEqual([]);
  });
});

describe('a workflow run whose output is too large', () => {
  it('settles as failed and fails for the tenant, naming the limit', async () => {
    const document = workflow('do:\n  - grow:\n      set: ${ .big }');

    const { ending, settlement } = await interpret(document, { input: { big: 'x'.repeat(1_100_000) } });

    expect(settlement).toEqual({ status: 'failed' });
    expect(ending).toEqual({
      kind: 'failed',
      type: 'WorkflowOutputTooLarge',
      message: "The workflow's output takes 1100002 bytes as JSON, more than the 1048574 an execution records",
    });
  });
});

describe('a workflow run that breaks down', () => {
  it.skipIf(onMachine)('settles as failed when the runtime beneath it breaks down', async () => {
    const { ending, settlement } = await interpret(pausing, {
      host: (fake) => ({ ...fake.host, sleep: () => Promise.reject(new Error('The timer service is gone')) }),
    });

    expect(settlement).toEqual({ status: 'failed' });
    expect(ending).toEqual({
      kind: 'faulted',
      type: 'WorkflowBrokeDown',
      message: 'The workflow broke down: Error: The timer service is gone',
    });
  });
});

describe('a workflow run that is cancelled', () => {
  it('settles as failed and ends cancelled', async () => {
    const { ending, settlement } = await interpret(pausing, {
      started: (_start, fake) => {
        fake.at(1000, () => {
          fake.cancelWorkflow();
        });
      },
    });

    expect(settlement).toEqual({ status: 'failed' });
    expect(ending.kind).toBe('cancelled');
  });

  it('cancels the work it runs at once', async () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - left: { wait: PT1H }
          - right: { wait: PT2H, timeout: { after: PT3H } }
`);

    const { commands } = await interpret(document, {
      started: (_start, fake) => {
        fake.at(1000, () => {
          fake.cancelWorkflow();
        });
      },
    });

    expect(commands).toContainEqual({ kind: 'cancelled', summary: '/do/0/both/fork/branches/1/right' });
  });
});
