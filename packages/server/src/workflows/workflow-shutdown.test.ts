import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';

import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { tcpPort } from '../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../testing/temporary-ledger.ts';
import { requestTo, settledOver, workflowProcess } from '../testing/workflow-process.ts';
import { executionIdIn, workflowSource, workflowTestTimeoutMs } from '../testing/workflow-server.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const greeting = workflowSource('greeting', 'do:\n  - greet: { set: { greeting: \'${ "Hello, " + .name }\' } }\n');

const welcome = ['---', 'model: stub/writer', '---', 'Welcome {{ input.name }}.'].join('\n');

const welcoming = workflowSource(
  'welcoming',
  "do:\n  - welcome: { call: execute_spec, with: { primitive: inference, name: welcome, input: { name: '${ .name }' } } }\n",
);

interface StubGateway {
  readonly gateways: string;
  readonly requests: () => number;
  readonly firstHeard: Promise<void>;
}

function answered(response: ServerResponse): void {
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      id: 'chatcmpl-stub',
      object: 'chat.completion',
      created: 1_790_000_000,
      model: 'stub',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Welcome, Ada.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    }),
  );
}

async function gatewayThatHangsFirst(): Promise<StubGateway> {
  const heard = Promise.withResolvers<void>();
  const counted = { requests: 0 };
  const server = createServer((request, response) => {
    counted.requests += 1;
    request.resume();
    if (counted.requests === 1) {
      heard.resolve();
      return;
    }
    answered(response);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    gateways: JSON.stringify([{ name: 'stub', base_url: `http://127.0.0.1:${tcpPort(server.address())}/v1` }]),
    requests: () => counted.requests,
    firstHeard: heard.promise,
  };
}

describe('a server that ran workflows, told to stop', { timeout: workflowTestTimeoutMs }, () => {
  it('exits 0 at once, holding nothing open', async () => {
    const child = workflowProcess(ledger.fileName);
    const port = await child.port;
    await requestTo(port, 'POST', '', { brain: 'alpha', name: 'Alpha' });
    await requestTo(port, 'POST', '/alpha/specs/orchestration', { name: 'greeting', source: greeting });
    const started = await requestTo(port, 'POST', '/alpha/specs/orchestration/greeting/execute', {
      input: { name: 'Ada' },
    });
    const settled = await settledOver(port, `/alpha/executions/${executionIdIn(started.body)}`);

    const stopping = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect(settled).toMatchObject({ status: 'succeeded', output: { greeting: 'Hello, Ada' } });
    expect(exitCode).toBe(0);
    expect(child.output().stderr).not.toContain('was still running');
    expect(performance.now() - stopping).toBeLessThan(3000);
  });

  it('exits 0 at once while a function a workflow called still runs, and calls it again once started again', async () => {
    const gateway = await gatewayThatHangsFirst();
    const first = workflowProcess(ledger.fileName, { MODEL_GATEWAYS: gateway.gateways });
    const firstPort = await first.port;
    await requestTo(firstPort, 'POST', '', { brain: 'beta', name: 'Beta' });
    await requestTo(firstPort, 'POST', '/beta/specs/inference', { name: 'welcome', source: welcome });
    await requestTo(firstPort, 'POST', '/beta/specs/orchestration', { name: 'welcoming', source: welcoming });
    const started = await requestTo(firstPort, 'POST', '/beta/specs/orchestration/welcoming/execute', {
      input: { name: 'Ada' },
    });
    await gateway.firstHeard;

    const stopping = performance.now();
    first.signal('SIGTERM');
    const exitCode = await first.exited;
    const stoppedWithinMs = performance.now() - stopping;
    const second = workflowProcess(ledger.fileName, { MODEL_GATEWAYS: gateway.gateways });
    const settled = await settledOver(await second.port, `/beta/executions/${executionIdIn(started.body)}`);
    second.signal('SIGTERM');

    expect(exitCode).toBe(0);
    expect(stoppedWithinMs).toBeLessThan(3000);
    expect(first.output().stderr).not.toContain('was still running');
    expect(settled).toMatchObject({ status: 'succeeded', output: 'Welcome, Ada.' });
    expect(gateway.requests()).toBe(2);
    expect(await second.exited).toBe(0);
  });
});
