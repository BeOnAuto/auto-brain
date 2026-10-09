import { setTimeout } from 'node:timers/promises';

import { Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { logLinesOf, requestTo, settledOver, workflowProcess } from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { runIdIn, workflowSource, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const approval = workflowSource(
  'approval',
  "do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.approved } } } }, output: { as: '${ $data[0] }' } }\n",
);

const pausing = workflowSource('pausing', 'do:\n  - pause: { wait: PT1S }\n  - done: { set: { paused: true } }\n');

const timing = workflowSource('timing', 'do:\n  - slow: { timeout: { after: PT1S }, wait: PT1H }\n');

const inputsOf = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ id: Schema.String, causation_id: Schema.NullOr(Schema.String), type: Schema.String }),
    ),
  }),
);

describe('main with workflows', { timeout: workflowTestTimeoutMs }, () => {
  it('says how it runs workflows, and exits 0 at once on SIGTERM', async () => {
    const child = workflowProcess(ledger.fileName);
    const port = await child.port;

    const stopping = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;
    const startUpLines = logLinesOf(child)
      .filter(({ message }) => !/^(?:Model provider|No model provider)/u.test(message))
      .map(({ message, level }) => `${level} ${message}`);

    expect(exitCode).toBe(0);
    expect(performance.now() - stopping).toBeLessThan(3000);
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(startUpLines.slice(1)).toEqual([
      `INFO The ledger is kept in the file ${ledger.fileName}`,
      'INFO Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms',
    ]);
    expect(startUpLines[0]).toMatch(/^WARN Local mode is on: /u);
  });
});

describe('a server started again on the ledger of its workflows', { timeout: workflowTestTimeoutMs }, () => {
  it('goes on with a run that waits for an event, and with ones whose timers went off while it was stopped, the fire of each caused by the record that armed it', async () => {
    const first = workflowProcess(ledger.fileName);
    const firstPort = await first.port;
    await requestTo(firstPort, 'POST', '', { brain: 'gamma', name: 'Gamma' });
    await requestTo(firstPort, 'POST', '/gamma/definitions/workflow', { name: 'approval', source: approval });
    await requestTo(firstPort, 'POST', '/gamma/definitions/workflow', { name: 'pausing', source: pausing });
    await requestTo(firstPort, 'POST', '/gamma/definitions/workflow', { name: 'timing', source: timing });
    const waiting = await requestTo(firstPort, 'POST', '/gamma/definitions/workflow/approval/run', { input: {} });
    const paused = await requestTo(firstPort, 'POST', '/gamma/definitions/workflow/pausing/run', { input: {} });
    const timed = await requestTo(firstPort, 'POST', '/gamma/definitions/workflow/timing/run', { input: {} });
    first.signal('SIGTERM');
    await first.exited;
    await setTimeout(1500);

    const second = workflowProcess(ledger.fileName);
    const port = await second.port;
    const sent = await requestTo(port, 'POST', `/gamma/runs/${runIdIn(waiting.body)}/events`, {
      event: { type: 'com.acme.approved', data: { by: 'Ada' } },
    });
    const approved = await settledOver(port, `/gamma/runs/${runIdIn(waiting.body)}`);
    const pausedSettled = await settledOver(port, `/gamma/runs/${runIdIn(paused.body)}`);
    await settledOver(port, `/gamma/runs/${runIdIn(timed.body)}`);
    const timedHistory = await requestTo(port, 'GET', `/gamma/runs/${runIdIn(timed.body)}/history?limit=100`);
    second.signal('SIGTERM');
    const inputs = inputsOf(timedHistory.body).events.filter(({ type }) => type === 'workflow_input_applied');

    expect(sent.status).toBe(200);
    expect(approved).toMatchObject({ status: 'succeeded', output: { by: 'Ada' } });
    expect(pausedSettled).toMatchObject({ status: 'succeeded', output: { paused: true } });
    expect(inputs.map(({ causation_id: causationId }) => causationId).at(-1)).toBe(inputs[0]?.id);
    expect(await second.exited).toBe(0);
  });
});
