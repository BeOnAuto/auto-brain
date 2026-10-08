import { OAuthError, OAuthErrorCode, requireBearerAuth } from '@modelcontextprotocol/server';
import { Option, Schema } from 'effect';

import { fakeAuthorization, type ClientRegistration, type FakeAuthorization } from './fake-authorization.ts';
import { fakeChat, type FakeChat } from './fake-chat.ts';
import { fakeSessions, type FakeSessions } from './fake-sessions.ts';
import type { ReceivedCall } from './fake-tools.ts';
import { serveOnLoopback, type FailedRequest, type FetchHandler } from './loopback-server.ts';

export interface FakeMcpOptions {
  readonly bearer?: string;
  readonly client?: ClientRegistration;
  readonly requestIdHeader?: string;
  readonly issuesSessionIds?: boolean;
  readonly annotated?: boolean;
  readonly chat?: boolean;
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
  readonly failures: () => readonly FailedRequest[];
  readonly received: () => readonly ReceivedCall[];
  readonly chat: FakeChat;
  readonly openSessions: () => number;
  readonly endedSessions: () => number;
  readonly tokenRequests: () => number;
  readonly answerNextWith: (status: number, times?: number, headers?: Readonly<Record<string, string>>) => void;
  readonly answerNextCallAfterNoise: (messages: number) => void;
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

interface NextAnswers {
  readonly programmed: () => Programmed | undefined;
  readonly noise: () => number;
  readonly answerWith: FakeMcpServer['answerNextWith'];
  readonly answerAfterNoise: FakeMcpServer['answerNextCallAfterNoise'];
}

function nextAnswers(): NextAnswers {
  const programmed: Programmed[] = [];
  let noise = 0;
  return {
    programmed: () => programmed.shift(),
    noise: () => {
      const messages = noise;
      noise = 0;
      return messages;
    },
    answerWith: (status, times = 1, headers = {}) => {
      programmed.push(...Array.from({ length: times }, () => ({ status, headers })));
    },
    answerAfterNoise: (messages) => {
      noise = messages;
    },
  };
}

interface Endpoint {
  readonly sessions: FakeSessions;
  readonly see: (seen: SeenRequest) => void;
  readonly next: NextAnswers;
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

async function afterNoise(response: Readonly<Response>, messages: number): Promise<Response> {
  if (messages === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const noise = 'event: message\ndata: not JSON-RPC\n\n'.repeat(messages);
  return new Response(`${noise}${await response.text()}`, { status: response.status, headers });
}

function mcpEndpoint({ sessions, see, next, requestIdHeader }: Endpoint): FetchHandler {
  let answered = 0;
  return async (request) => {
    const rpc = await rpcOf(request);
    see({
      method: request.method,
      rpc,
      session: request.headers.get('mcp-session-id'),
      authorization: request.headers.get('authorization'),
    });
    const programmed = next.programmed();
    if (programmed !== undefined) {
      return new Response(JSON.stringify({ error: `answered ${programmed.status}` }), programmed);
    }
    answered += 1;
    const response = withRequestId(await routed(sessions, request), requestIdHeader, `request-${answered}`);
    return rpc === 'tools/call' ? afterNoise(response, next.noise()) : response;
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

function recordsOf(options: FakeMcpOptions, removed: ReadonlySet<string>, chat: FakeChat) {
  return {
    isRemoved: (tool: string) => removed.has(tool),
    annotated: options.annotated ?? true,
    chat: options.chat === true ? chat : undefined,
  };
}

export async function serveFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const seen: SeenRequest[] = [];
  const next = nextAnswers();
  const received: ReceivedCall[] = [];
  const removed = new Set<string>();
  const authorizations: FakeAuthorization[] = [];
  const chat = fakeChat();
  const records = recordsOf(options, removed, chat);
  const sessions = fakeSessions({ ...records, receive: (call) => received.push(call) }, options.issuesSessionIds);
  const endpoint = mcpEndpoint({
    sessions,
    see: (request) => {
      seen.push(request);
    },
    next,
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
    failures: listening.failures,
    received: () => [...received],
    chat,
    openSessions: sessions.open,
    endedSessions: sessions.ended,
    tokenRequests: () => authorizations.reduce((total, authorization) => total + authorization.tokenRequests(), 0),
    answerNextWith: next.answerWith,
    answerNextCallAfterNoise: next.answerAfterNoise,
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
