import { OAuthError, OAuthErrorCode, requireBearerAuth } from '@modelcontextprotocol/server';
import { Option, Schema } from 'effect';

import { fakeAuthorization, type ClientRegistration, type FakeAuthorization } from './fake-authorization.ts';
import { fakeSessions, type FakeSessions } from './fake-sessions.ts';
import type { ReceivedCall } from './fake-tools.ts';
import { serveOnLoopback, type FetchHandler } from './loopback-server.ts';

export interface FakeMcpOptions {
  readonly bearer?: string;
  readonly client?: ClientRegistration;
  readonly requestIdHeader?: string;
}

export interface SeenRequest {
  readonly method: string;
  readonly rpc: string | undefined;
  readonly session: string | null;
  readonly authorization: string | null;
}

export interface FakeMcpServer {
  readonly url: string;
  readonly origin: string;
  readonly seen: () => readonly SeenRequest[];
  readonly received: () => readonly ReceivedCall[];
  readonly openSessions: () => number;
  readonly endedSessions: () => number;
  readonly tokenRequests: () => number;
  readonly answerNextWith: (status: number, times?: number, headers?: Readonly<Record<string, string>>) => void;
  readonly forgetSessions: () => void;
  readonly revokeTokens: () => void;
  readonly removeTool: (name: string) => void;
  readonly notifyToolsChanged: () => void;
  readonly close: () => Promise<void>;
}

interface Programmed {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

interface Endpoint {
  readonly sessions: FakeSessions;
  readonly see: (seen: SeenRequest) => void;
  readonly programmed: () => Programmed | undefined;
  readonly requestIdHeader: string | undefined;
}

const decodeRpc = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ method: Schema.optionalKey(Schema.String) })),
);

const farFuture = 4_102_444_800;

function forgotten(): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_001, message: 'Session not found' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

async function rpcOf(request: Readonly<Request>): Promise<string | undefined> {
  return Option.getOrUndefined(decodeRpc(await request.clone().text()))?.method;
}

function withRequestId(response: Readonly<Response>, name: string | undefined, value: string): Response {
  if (name === undefined) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

function routed(sessions: FakeSessions, request: Readonly<Request>): Promise<Response> {
  const id = request.headers.get('mcp-session-id');
  return id === null ? sessions.opened(request) : (sessions.answered(id, request) ?? Promise.resolve(forgotten()));
}

function mcpEndpoint({ sessions, see, programmed, requestIdHeader }: Endpoint): FetchHandler {
  let answered = 0;
  return async (request) => {
    see({
      method: request.method,
      rpc: await rpcOf(request),
      session: request.headers.get('mcp-session-id'),
      authorization: request.headers.get('authorization'),
    });
    const next = programmed();
    if (next !== undefined) {
      return new Response(JSON.stringify({ error: `answered ${next.status}` }), next);
    }
    answered += 1;
    return withRequestId(await routed(sessions, request), requestIdHeader, `request-${answered}`);
  };
}

function bearerChecked(
  endpoint: FetchHandler,
  origin: string,
  bearer: string | undefined,
  authorization: FakeAuthorization | undefined,
): FetchHandler {
  const gate = requireBearerAuth({
    verifier: {
      verifyAccessToken: (token) =>
        token === bearer || authorization?.accepts(token) === true
          ? Promise.resolve({ token, clientId: 'brain', scopes: [], expiresAt: farFuture })
          : Promise.reject(new OAuthError(OAuthErrorCode.InvalidToken, 'The token is not valid')),
    },
    resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource/mcp`,
  });
  return async (request) => {
    const passed = await gate(request);
    return passed instanceof Response ? passed : endpoint(request);
  };
}

function guarded(
  endpoint: FetchHandler,
  origin: string,
  options: FakeMcpOptions,
  keep: (authorization: FakeAuthorization) => void,
): FetchHandler {
  const authorization = options.client === undefined ? undefined : fakeAuthorization(origin, options.client);
  if (authorization !== undefined) {
    keep(authorization);
  }
  const checked =
    options.bearer === undefined && authorization === undefined
      ? endpoint
      : bearerChecked(endpoint, origin, options.bearer, authorization);
  return (request) => authorization?.answer(request) ?? checked(request);
}

export async function serveFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const seen: SeenRequest[] = [];
  const programmed: Programmed[] = [];
  const received: ReceivedCall[] = [];
  const removed = new Set<string>();
  const authorizations: FakeAuthorization[] = [];
  const sessions = fakeSessions({
    receive: (call) => received.push(call),
    isRemoved: (tool) => removed.has(tool),
  });
  const endpoint = mcpEndpoint({
    sessions,
    see: (request) => {
      seen.push(request);
    },
    programmed: () => programmed.shift(),
    requestIdHeader: options.requestIdHeader,
  });
  const listening = await serveOnLoopback((origin) =>
    guarded(endpoint, origin, options, (authorization) => {
      authorizations.push(authorization);
    }),
  );
  return {
    url: `${listening.origin}/mcp`,
    origin: listening.origin,
    seen: () => [...seen],
    received: () => [...received],
    openSessions: sessions.open,
    endedSessions: sessions.ended,
    tokenRequests: () => authorizations.reduce((total, authorization) => total + authorization.tokenRequests(), 0),
    answerNextWith: (status, times = 1, headers = {}) => {
      programmed.push(...Array.from({ length: times }, () => ({ status, headers })));
    },
    forgetSessions: sessions.forget,
    revokeTokens: () => {
      for (const authorization of authorizations) {
        authorization.revokeEveryToken();
      }
    },
    removeTool: (name) => {
      removed.add(name);
    },
    notifyToolsChanged: sessions.notifyToolsChanged,
    close: async () => {
      sessions.forget();
      await listening.close();
    },
  };
}
