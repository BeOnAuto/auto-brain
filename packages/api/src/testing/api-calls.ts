import { createApiHandler, type ApiHandler, type ApiOptions, type RegisterRoutes } from '../index.ts';

export interface Call {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
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

export function handlerWith(options: Partial<ApiOptions> = {}): { handler: ApiHandler; reported: Reported[] } {
  const reported: Reported[] = [];
  const handler = createApiHandler({
    allowedOrigins: [],
    localMode: false,
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
  { method = 'GET', headers = {} }: Call = {},
): Promise<Answer> {
  const response = await handler.fetch(new Request(`http://localhost${path}`, { method, headers }));
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: text === '' ? undefined : JSON.parse(text) };
}

export const echoRequestId: RegisterRoutes = (routes) => {
  routes.add('GET', '/echo', (c) => c.json({ requestId: c.get('requestId') }));
};
