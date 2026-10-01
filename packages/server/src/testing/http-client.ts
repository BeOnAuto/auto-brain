export interface TestResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

export interface RequestOptions {
  readonly key?: string;
  readonly body?: unknown;
}

export async function request(
  port: number,
  method: string,
  path: string,
  { key, body }: RequestOptions = {},
): Promise<TestResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) };
}
