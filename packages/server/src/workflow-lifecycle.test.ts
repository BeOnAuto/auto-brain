import { randomUUID } from 'node:crypto';

import { connectOrchestration, installTemporalRuntime, type TemporalLogEntry } from '@beonauto/orchestration';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Effect, Exit, Scope } from 'effect';
import { afterAll, describe, expect, inject, it, onTestFinished } from 'vitest';

import { temporaryLedger } from './testing/temporary-ledger.ts';
import {
  acceptedOnceUp,
  freePort,
  logLinesOf,
  requestTo,
  settledOver,
  untilLogged,
  workflowProcess,
} from './testing/workflow-process.ts';
import { executionIdIn, workflowSource, workflowTestTimeoutMs } from './testing/workflow-server.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const workerStarted = (message: string): boolean => message === 'The workflow worker started';

const unsettled = 'An execution stays started because settling it failed';

const greeting = workflowSource('greeting', 'do:\n  - greet: { set: { greeting: \'${ "Hello, " + .name }\' } }\n');

const temporalLogsOfThisProcess: TemporalLogEntry[] = [];

describe('main with workflows', { timeout: workflowTestTimeoutMs }, () => {
  it('says where it offers workflows, starts the worker, and exits 0 on SIGTERM', async () => {
    const taskQueue = `server-${randomUUID()}`;
    const address = inject('temporalAddress');
    const child = workflowProcess(ledger.fileName, address, taskQueue);
    const port = await child.port;
    await untilLogged(child, workerStarted);

    const stopping = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;
    const startUpLines = logLinesOf(child)
      .filter(({ message }) => !message.startsWith('Model provider'))
      .map(({ message, level }) => `${level} ${message}`);

    expect(exitCode).toBe(0);
    expect(performance.now() - stopping).toBeLessThan(3000);
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(startUpLines.slice(1)).toEqual([
      `INFO Workflows are offered with Temporal at ${address}, namespace default, task queue ${taskQueue}`,
      'INFO The workflow worker started',
    ]);
    expect(startUpLines[0]).toMatch(/^WARN Local mode is on: /u);
  });
});

describe('a server whose Temporal starts after it', { timeout: 120_000 }, () => {
  it('serves brains, answers executions unavailable within the deadline, and runs workflows once Temporal is up', async () => {
    const temporalPort = await freePort();
    const child = workflowProcess(ledger.fileName, `127.0.0.1:${temporalPort}`, `server-${randomUUID()}`);
    const port = await child.port;
    await untilLogged(child, (message) => message.startsWith('The workflow worker could not start; it tries again in'));
    const created = await requestTo(port, 'POST', '', { brain: 'beta', name: 'Beta' });
    await requestTo(port, 'POST', '/beta/specs/orchestration', { name: 'greeting', source: greeting });
    const before = performance.now();
    const whileDown = await requestTo(port, 'POST', '/beta/specs/orchestration/greeting/execute', { input: {} });
    const waited = performance.now() - before;

    installTemporalRuntime((entry) => {
      temporalLogsOfThisProcess.push(entry);
    });
    const temporal = await TestWorkflowEnvironment.createLocal({
      server: { ip: '127.0.0.1', port: temporalPort, log: { format: 'pretty', level: 'error' } },
    });
    onTestFinished(() => temporal.teardown());
    await untilLogged(child, workerStarted);
    const started = await acceptedOnceUp(port, '/beta/specs/orchestration/greeting/execute', {
      input: { name: 'Ada' },
    });
    const settled = await settledOver(port, `/beta/executions/${executionIdIn(started.body)}`);
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect(created.status).toBe(201);
    expect(whileDown).toMatchObject({ status: 503, body: { reason: 'unavailable' } });
    expect(waited).toBeLessThan(11_000);
    expect(settled).toMatchObject({ status: 'succeeded', output: { greeting: 'Hello, Ada' } });
    expect(exitCode).toBe(0);
  });
});

describe('an execution a workflow cannot settle', { timeout: workflowTestTimeoutMs }, () => {
  it('is logged as an error with its org, brain, id and the reason, and nothing of its input or output', async () => {
    const taskQueue = `server-${randomUUID()}`;
    const address = inject('temporalAddress');
    const child = workflowProcess(ledger.fileName, address, taskQueue);
    await child.port;
    await untilLogged(child, workerStarted);
    const executionId = randomUUID();
    const scope = Effect.runSync(Scope.make());
    const client = await Effect.runPromise(
      connectOrchestration({
        address,
        namespace: 'default',
        taskQueue,
        tls: false,
        mostDuration: 7_200_000,
        nestedExecutions: 32,
      }).pipe(Scope.provide(scope)),
    );
    await Effect.runPromise(
      client.start({
        document: {
          document: { dsl: '1.0.3', namespace: 'acme', name: 'ghost', version: '1.0.0' },
          do: [{ done: { set: { secret: 'output-secret' } } }],
        },
        input: { secret: 'input-secret' },
        execution: { id: executionId, org: 'acme', brain: 'alpha', spec: { name: 'ghost', version: 1 } },
        caller: { id: 'local', org: 'acme', permissions: ['brain:read', 'brain:write'], brains: '*' },
      }),
    );
    await untilLogged(child, (message) => message === unsettled);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    child.signal('SIGTERM');
    await child.exited;
    const reported = logLinesOf(child).filter(({ message }) => message === unsettled);

    expect(reported.map(({ level, annotations }) => ({ level, fields: Object.keys(annotations) }))).toEqual([
      { level: 'ERROR', fields: ['org', 'brain', 'execution_id', 'reason'] },
    ]);
    expect(reported[0]?.annotations).toMatchObject({ org: 'acme', brain: 'alpha', execution_id: executionId });
    expect(String(reported[0]?.annotations['reason'])).toMatch(/^The ledger has no such execution/u);
    expect(child.output().stderr).not.toContain('secret');
  });
});
