import { expect } from 'vitest';

import { serveFakeApi } from '../api-testing/fake-api-server.ts';
import { serveFakeMcp } from '../testing/fake-mcp-server.ts';

export const behaviourKey = 'graph-api-key-4f1d9a7c2b';

export interface ServedUnderTest {
  readonly entry: Readonly<Record<string, unknown>>;
  readonly echoed: (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
  readonly failNextCall: (status: number, headers?: Readonly<Record<string, string>>) => void;
  readonly calls: () => number;
  readonly requests: () => number;
  readonly sessionsOpen: () => number;
  readonly jsonrpcId: unknown;
  readonly close: () => Promise<void>;
}

export interface ServerUnderTest {
  readonly kind: string;
  readonly serve: (requestIdHeader?: string) => Promise<ServedUnderTest>;
}

export const mcpUnderTest: ServerUnderTest = {
  kind: 'an MCP server',
  serve: async (requestIdHeader) => {
    const fake = await serveFakeMcp({
      bearer: behaviourKey,
      ...(requestIdHeader === undefined ? {} : { requestIdHeader }),
    });
    return {
      entry: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      echoed: (input) => input,
      failNextCall: (status, headers = {}) => {
        fake.answerNextOf('tools/call', status, 1, headers);
      },
      calls: () => fake.seen().filter(({ rpc }) => rpc === 'tools/call').length,
      requests: () => fake.seen().length,
      sessionsOpen: fake.openSessions,
      jsonrpcId: expect.any(Number),
      close: fake.close,
    };
  },
};

export const apiUnderTest: ServerUnderTest = {
  kind: 'an HTTP API',
  serve: async (requestIdHeader) => {
    const fake = await serveFakeApi({
      key: behaviourKey,
      ...(requestIdHeader === undefined ? {} : { requestIdHeader }),
    });
    return {
      entry: { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' }, org: 'acme' },
      echoed: (input) => ({ body: input }),
      failNextCall: (status, headers = {}) => {
        fake.answerNextWith({ status, headers });
      },
      calls: () => fake.seen().length,
      requests: () => fake.seen().length + fake.documentReads(),
      sessionsOpen: () => 0,
      jsonrpcId: null,
      close: fake.close,
    };
  },
};
