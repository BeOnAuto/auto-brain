import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  developmentFiles,
  developmentTestTimeoutMs,
  localTemporalPorts,
  readyNoticesOf,
  startDevelopment,
  temporalLines,
  untilListening,
} from '../testing/development-process.ts';
import {
  greetingSettled,
  howToGetWorkflows,
  notTemporalOn,
  servedWithoutWorkflows,
  stoppedWith,
  webUiAnswer,
} from '../testing/development-workflows.ts';
import { acceptedOnceUp, requestTo, settledOver } from '../testing/workflow-process.ts';
import { executionIdIn, workflowSource } from '../testing/workflow-server.ts';

const approval = workflowSource(
  'approval',
  'do:\n  - decide: { listen: { to: { one: { with: { type: com.example.approval.decided } } } } }\n',
);

const approved = { event: { type: 'com.example.approval.decided', data: { approved: true } } };

async function waitingForApproval(port: number): Promise<string> {
  await requestTo(port, 'POST', '', { brain: 'alpha', name: 'Alpha' });
  await requestTo(port, 'POST', '/alpha/specs/orchestration', { name: 'approval', source: approval });
  const started = await acceptedOnceUp(port, '/alpha/specs/orchestration/approval/execute', { input: {} });
  return executionIdIn(started.body);
}

describe('pnpm dev with a Temporal of its own', { timeout: developmentTestTimeoutMs }, () => {
  it('starts Temporal, then the server pointed at it, where a pure workflow succeeds', async () => {
    const temporal = await localTemporalPorts();
    const development = startDevelopment(developmentFiles(), { temporal });

    const port = await untilListening(development);
    const settled = await greetingSettled(port);
    const ui = await webUiAnswer(`http://127.0.0.1:${temporal.uiPort}`);

    expect({ settled, ui, ...(await stoppedWith(development, 'SIGTERM')) }).toMatchObject({
      settled: { status: 'succeeded', output: { greeting: 'Hello, Ada' } },
      ui: 200,
      exitCode: 0,
      said: [
        `Temporal v1.9.1 is running on 127.0.0.1:${temporal.port} with its state in ${development.files.stateFile}; web UI at http://127.0.0.1:${temporal.uiPort}`,
      ],
    });
    expect(readyNoticesOf(development)).toEqual([
      [
        `  server     http://localhost:${port}`,
        `  workflows  Temporal web UI at http://127.0.0.1:${temporal.uiPort}`,
        '  models     none configured; copy .env.example to .env and put a key in it',
        `  MCP        http://localhost:${port}/mcp`,
      ].join('\n'),
    ]);
  });

  it('starts the server without workflows, saying why, when Temporal cannot start', async () => {
    const temporal = await localTemporalPorts();
    await notTemporalOn(temporal.uiPort);

    const development = startDevelopment(developmentFiles(), { temporal });

    await expect(servedWithoutWorkflows(development)).resolves.toEqual({
      exitCode: 0,
      said: [
        `Temporal's dev server could not start (exit code 1), so the server starts without workflows; ${howToGetWorkflows}`,
      ],
    });
    expect(temporalLines(development)).toEqual([
      `ERROR Error: can't set UI port ${temporal.uiPort}: listen tcp 127.0.0.1:${temporal.uiPort}: bind: address already in use`,
    ]);
  });
});

describe('pnpm dev without what Temporal needs', { timeout: developmentTestTimeoutMs }, () => {
  it('starts the server without workflows, saying why, when the Temporal CLI cannot be obtained', async () => {
    const development = startDevelopment(developmentFiles(), {
      temporal: await localTemporalPorts(),
      obtain: { unobtainable: 'no network' },
    });

    await expect(servedWithoutWorkflows(development)).resolves.toEqual({
      exitCode: 0,
      said: [
        `The Temporal CLI could not be obtained (Error: no network), so the server starts without workflows; ${howToGetWorkflows}`,
      ],
    });
  });

  it('starts the server without workflows, saying why, when there is nowhere to keep Temporal state', async () => {
    const files = developmentFiles();
    writeFileSync(dirname(files.stateFile), 'not a directory\n');

    const stopped = servedWithoutWorkflows(startDevelopment(files, { temporal: await localTemporalPorts() }));

    await expect(stopped).resolves.toEqual({
      exitCode: 0,
      said: [
        `Temporal's dev server could not start (Error: EEXIST: file already exists, mkdir '${dirname(files.stateFile)}'), so the server starts without workflows; ${howToGetWorkflows}`,
      ],
    });
  });
});

describe('restarting pnpm dev', { timeout: developmentTestTimeoutMs }, () => {
  it('keeps a workflow waiting on listen, which settles with an event sent after the restart', async () => {
    const files = developmentFiles();
    const temporal = await localTemporalPorts();
    const before = startDevelopment(files, { temporal });
    const execution = await waitingForApproval(await untilListening(before));
    const stoppedBefore = await stoppedWith(before, 'SIGTERM');

    const after = startDevelopment(files, { temporal });
    const port = await untilListening(after);
    const sent = await acceptedOnceUp(port, `/alpha/executions/${execution}/events`, approved);
    const settled = await settledOver(port, `/alpha/executions/${execution}`);

    expect({ stoppedBefore, sent: sent.status, settled }).toMatchObject({
      stoppedBefore: { exitCode: 0 },
      sent: 200,
      settled: { status: 'succeeded', output: [{ approved: true }] },
    });
  });
});
