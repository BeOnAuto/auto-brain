import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from './composition-root.ts';
import { startServer, type RunningServer } from './lifecycle.ts';
import { request, type TestResponse } from './testing/http-client.ts';
import { alpha } from './testing/inference-server.ts';
import { temporaryLedger, type TemporaryLedger } from './testing/temporary-ledger.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer(
    { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, LOCAL_MODE: 'true' },
    compositionRoot,
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

function calling(method: string, path: string, body: object): Promise<TestResponse> {
  return request(server.port, method, path, { body });
}

describe('an execution of a provider the server is not configured for', () => {
  it('answers 503 naming the provider and the settings it lacks, without a model call', async () => {
    await calling('POST', '/v1/orgs/acme/brains', { brain: 'alpha', name: 'Alpha' });
    await calling('POST', `${alpha}/specs/inference`, { name: 'verdict', source: verdict });

    expect(
      await calling('POST', `${alpha}/specs/inference/verdict/execute`, { input: { expense: 'a dinner' } }),
    ).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', detail: 'openai is not configured; it needs OPENAI_API_KEY' },
    });
  });
});
