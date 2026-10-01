import type { IncomingMessage, ServerResponse } from 'node:http';

import { getRequestListener } from '@hono/node-server';

import type { ApiOptions } from './api-options.ts';
import { createApp } from './app.ts';
import { withStandardHeaders } from './checks/standard-headers.ts';
import { answerFaults } from './problem/fault-boundary.ts';
import { answerUnreadableRequest } from './problem/unreadable-request.ts';

export interface ApiHandler {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly listener: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  readonly close: () => Promise<void>;
}

export function createApiHandler(options: ApiOptions): ApiHandler {
  const app = createApp(options);
  const answerFault = answerFaults(options.reportIncident);
  const answer = async (request: Request): Promise<Response> => {
    try {
      return await app.fetch(request);
    } catch (thrown) {
      return withStandardHeaders(answerFault(thrown));
    }
  };
  return {
    fetch: answer,
    listener: getRequestListener(answer, {
      overrideGlobalObjects: false,
      errorHandler: () => withStandardHeaders(answerUnreadableRequest()),
    }),
    close: () => Promise.resolve(),
  };
}
