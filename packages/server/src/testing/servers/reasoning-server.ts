import { makeModelAccess } from '@beonauto/reasoning';
import { scriptedLanguageModel, type ScriptedReply } from '@beonauto/reasoning/testing';
import type { HostClock } from '@beonauto/workflow-host';
import { Effect } from 'effect';

import { compositionRootWith } from '../../composition/composition-root.ts';
import { workerPool, type ProgramPoolOf } from '../../composition/served-computation.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { request, type RequestOptions, type TestResponse } from './http-client.ts';

export interface ReasoningServer {
  readonly origin: string;
  readonly call: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  readonly modelCalls: () => number;
  readonly modelRunIds: () => readonly (string | undefined)[];
  readonly stop: () => Promise<void>;
}

export interface ServedParts {
  readonly programPoolOf?: ProgramPoolOf;
  readonly clock?: HostClock;
}

export const alpha = '/v1/orgs/acme/brains/alpha';

const localMode: Readonly<Record<string, string>> = { LOCAL_MODE: 'true' };

type Fetch = typeof globalThis.fetch;

const noNetwork: Fetch = () => Promise.reject(new TypeError('fetch failed: the tests reach no network'));

export async function servingReasoning(
  replies: readonly ScriptedReply[],
  environment: Readonly<Record<string, string>> = localMode,
  fetch: Fetch = noNetwork,
  { programPoolOf = workerPool, clock }: ServedParts = {},
): Promise<ReasoningServer> {
  const ledger = temporaryLedger();
  const scripted = scriptedLanguageModel(...replies);
  const server = await startServer(
    { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, ...environment },
    compositionRootWith(
      (settings) =>
        Effect.map(makeModelAccess(settings, { fetch }), (access) => ({
          ...access,
          languageModel: scripted.languageModel,
        })),
      programPoolOf,
      clock,
    ),
  );
  return {
    origin: `http://127.0.0.1:${server.port}`,
    call: (method, path, options) => request(server.port, method, path, options),
    modelCalls: () => scripted.requests().length,
    modelRunIds: () => scripted.requests().map(({ run_id: runId }) => runId),
    stop: async () => {
      await server.stop();
      ledger.remove();
    },
  };
}
