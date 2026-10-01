import type { Authenticator } from '@beonauto/identity';
import { everyPermission } from '@beonauto/operations';

import { createApiHandler, type ApiHandler, type ApiOptions, type RegisterRoutes } from '../index.ts';

export interface Call {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

export interface Reported {
  readonly incident: string;
  readonly message: string;
  readonly cause: unknown;
}

const admitEveryone: Authenticator = {
  mode: 'keys',
  authenticate: () => ({ callerIn: (org) => ({ id: 'anyone', org, permissions: everyPermission, brains: '*' }) }),
};

export function handlerWith(options: Partial<ApiOptions> = {}): { handler: ApiHandler; reported: Reported[] } {
  const reported: Reported[] = [];
  const handler = createApiHandler({
    allowedOrigins: [],
    authenticator: admitEveryone,
    routes: [],
    reportIncident: (incident, error) => {
      reported.push({ incident, message: error.message, cause: error.cause });
    },
    ...options,
  });
  return { handler, reported };
}

export async function call(
  handler: ApiHandler,
  path: string,
  { method = 'GET', headers = {}, body }: Call = {},
): Promise<Answer> {
  const init = body === undefined ? { method, headers } : { method, headers, body };
  const response = await handler.fetch(new Request(`http://localhost${path}`, init));
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: text === '' ? undefined : JSON.parse(text) };
}

export const echoRequestId: RegisterRoutes = (routes) => {
  routes.add('GET', '/echo', (c) =>
    c.json({ requestId: c.get('requestId'), caller: c.get('principal').callerIn('acme').id }),
  );
};
