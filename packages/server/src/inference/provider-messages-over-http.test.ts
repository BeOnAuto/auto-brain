import { makeModelAccess } from '@beonauto/inference';
import { gatewayError, gatewayErrorText, gatewayInternals, recordingReporter } from '@beonauto/inference/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRootWith } from '../composition/composition-root.ts';
import { startServer, type RunningServer } from '../lifecycle/lifecycle.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request, type TestResponse } from '../testing/servers/http-client.ts';

const alpha = '/v1/orgs/acme/brains/alpha';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const source = '---\nmodel: gateway/no-such-model-xyz\n---\nSay hello.';

const gateways = JSON.stringify([{ name: 'gateway', base_url: 'https://llm.internal.example/v1' }]);

function gatewayAnswer(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(gatewayError), { status: 404, headers: { 'content-type': 'application/json' } }),
  );
}

const reporter = recordingReporter();

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer(
    { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, LOCAL_MODE: 'true', MODEL_GATEWAYS: gateways },
    compositionRootWith((settings) =>
      makeModelAccess(settings, { fetch: gatewayAnswer, reportProviderMessage: reporter.report }),
    ),
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

function internalsIn({ text }: TestResponse): readonly string[] {
  return gatewayInternals.filter((internal) => text.includes(internal));
}

describe('an execution whose gateway rejects the model', () => {
  it('answers and records only what the status says, and gives the gateway text to the operator', async () => {
    await request(server.port, 'POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await request(server.port, 'POST', `${alpha}/specs/inference`, { body: { name: 'hello', source } });
    const executed = await request(server.port, 'POST', `${alpha}/specs/inference/hello/execute`, {
      body: { input: {}, execution_id: executionId },
    });
    const recorded = await request(server.port, 'GET', `${alpha}/executions/${executionId}`);
    const detail = 'gateway answered HTTP 404: the model was not found; update the reasoning function definition';

    expect(executed).toMatchObject({ status: 409, body: { reason: 'conflict', detail } });
    expect(recorded).toMatchObject({
      status: 200,
      body: { status: 'rejected', rejection: { reason: 'conflict', detail } },
    });
    expect([...internalsIn(executed), ...internalsIn(recorded)]).toEqual([]);
    expect(reporter.reports()).toEqual([
      {
        provider: 'gateway',
        model: 'gateway/no-such-model-xyz',
        status: 404,
        message: gatewayErrorText,
        execution_id: executionId,
      },
    ]);
  });
});
