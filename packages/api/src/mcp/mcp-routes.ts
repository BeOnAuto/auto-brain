import { canAccessBrain, type CallerIdentity, type OperationScope } from '@beonauto/operations';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';

import { authInfoFor, type BrainCall, type OrgCall } from '../hand-off/caller-hand-off.ts';
import { droppedArgumentsOf } from '../hand-off/dropped-arguments.ts';
import { requestBodyLimit } from '../operations/request-body.ts';
import { problemOf, problemResponse, type Problem } from '../problem/problem.ts';
import type { RegisterRoutes, RouteHandler } from '../routes.ts';
import type { McpServing } from './mcp-connection.ts';
import {
  brainServerFactory,
  catalogServerFactory,
  orgServerFactory,
  type McpServerFactory,
} from './mcp-server-factory.ts';

export interface McpRoutesOptions extends McpServing {
  readonly reportError: (error: Readonly<Error>) => void;
}

type FetchMcp = McpHttpHandler['fetch'];

const insufficientScope = { 'www-authenticate': 'Bearer error="insufficient_scope"' };

const anotherOrg = problemOf('forbidden', 'The caller does not belong to this org');

const anotherBrain = problemOf('forbidden', 'The caller may not access this brain');

const tokenOverMcp = problemOf(
  'unauthenticated',
  'The answer token of a request answers it over HTTP alone, as Request <token>; MCP takes an API key, as Bearer <key>',
);

function refusingRequestTokens(handler: RouteHandler): RouteHandler {
  return (c) =>
    c.get('principal').requestToken === undefined
      ? handler(c)
      : problemResponse(tokenOverMcp, { 'www-authenticate': 'Bearer error="invalid_token"' });
}

function rejectionOf(caller: CallerIdentity, org: string, brain: string | undefined): Problem | undefined {
  if (caller.org !== org) {
    return anotherOrg;
  }
  return brain === undefined || canAccessBrain(caller.brains, brain) ? undefined : anotherBrain;
}

async function handedOff(
  fetchMcp: FetchMcp,
  request: Request,
  call: Omit<OrgCall, 'dropped'> | Omit<BrainCall, 'dropped'>,
): Promise<Response> {
  const dropped = await droppedArgumentsOf(request);
  return fetchMcp(request, { authInfo: authInfoFor({ ...call, dropped }) });
}

function endpoint(fetchMcp: FetchMcp, scope: OperationScope): RouteHandler {
  return (c) => {
    const org = String(c.req.param('org'));
    const brain = scope === 'brain' ? String(c.req.param('brain')) : undefined;
    const caller = c.get('principal').callerIn(org);
    const rejection = rejectionOf(caller, org, brain);
    if (rejection !== undefined) {
      return problemResponse(rejection, insufficientScope);
    }
    const requestId = c.get('requestId');
    const call = brain === undefined ? { caller, org, requestId } : { caller, org, brain, requestId };
    return handedOff(fetchMcp, c.req.raw, call);
  };
}

function ownOrgEndpoint(fetchMcp: FetchMcp): RouteHandler {
  return (c) => {
    const { org, callerIn } = c.get('principal');
    return handedOff(fetchMcp, c.req.raw, { caller: callerIn(org), org, requestId: c.get('requestId') });
  };
}

function handlerFor(factory: McpServerFactory, { reportError }: McpRoutesOptions): McpHttpHandler {
  return createMcpHandler(factory, { legacy: 'stateless', maxRequestBodySize: requestBodyLimit, onerror: reportError });
}

export function mcpRoutes(options: McpRoutesOptions): RegisterRoutes {
  return (routes) => {
    const serving = { ...options, reportThrown: routes.reportThrown };
    const catalog = handlerFor(catalogServerFactory(serving), options);
    const org = handlerFor(orgServerFactory(serving), options);
    const brain = handlerFor(brainServerFactory(serving), options);
    routes.add('POST', '/mcp', refusingRequestTokens(ownOrgEndpoint(catalog.fetch)));
    routes.add('POST', '/orgs/:org/mcp', refusingRequestTokens(endpoint(org.fetch, 'org')));
    routes.add('POST', '/orgs/:org/brains/:brain/mcp', refusingRequestTokens(endpoint(brain.fetch, 'brain')));
    routes.onClose(async () => {
      await Promise.all([catalog.close(), org.close(), brain.close()]);
    });
  };
}
