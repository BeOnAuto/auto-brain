import { makeModelAccess } from '@beonauto/inference';
import { scriptedLanguageModel, type ScriptedReply } from '@beonauto/inference/testing';
import { Effect } from 'effect';

import { compositionRootWith } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { request, type RequestOptions, type TestResponse } from './http-client.ts';
import { temporaryLedger } from './temporary-ledger.ts';

export interface InferenceServer {
  readonly origin: string;
  readonly call: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  readonly modelCalls: () => number;
  readonly modelExecutions: () => readonly (string | undefined)[];
  readonly stop: () => Promise<void>;
}

export const alpha = '/v1/orgs/acme/brains/alpha';

const localMode: Readonly<Record<string, string>> = { LOCAL_MODE: 'true' };

type Fetch = typeof globalThis.fetch;

const noNetwork: Fetch = () => Promise.reject(new TypeError('fetch failed: the tests reach no network'));

export async function servingInference(
  replies: readonly ScriptedReply[],
  environment: Readonly<Record<string, string>> = localMode,
  fetch: Fetch = noNetwork,
): Promise<InferenceServer> {
  const ledger = temporaryLedger();
  const scripted = scriptedLanguageModel(...replies);
  const server = await startServer(
    { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, ...environment },
    compositionRootWith((settings) =>
      Effect.map(makeModelAccess(settings, { fetch }), (access) => ({
        ...access,
        languageModel: scripted.languageModel,
      })),
    ),
  );
  return {
    origin: `http://127.0.0.1:${server.port}`,
    call: (method, path, options) => request(server.port, method, path, options),
    modelCalls: () => scripted.requests().length,
    modelExecutions: () => scripted.requests().map(({ execution_id: executionId }) => executionId),
    stop: async () => {
      await server.stop();
      ledger.remove();
    },
  };
}
