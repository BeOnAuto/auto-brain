import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { canAccessPlaybook, type CallerIdentity, type OperationScope } from '@on.auto/operations';

import { authInfoFor, type PlaybookCall, type OrgCall } from '../hand-off/caller-hand-off.ts';
import { droppedArgumentsOf } from '../hand-off/dropped-arguments.ts';
import { requestBodyLimit } from '../operations/request-body.ts';
import type { Problem } from '../problem/problem-document.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';
import type { RegisterRoutes, RouteHandler } from '../routes.ts';
import type { McpServing } from './mcp-connection.ts';
import {
  playbookServerFactory,
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

const anotherPlaybook = problemOf('forbidden', 'The caller may not access this playbook');

function rejectionOf(caller: CallerIdentity, org: string, playbook: string | undefined): Problem | undefined {
  if (caller.org !== org) {
    return anotherOrg;
  }
  return playbook === undefined || canAccessPlaybook(caller.playbooks, playbook) ? undefined : anotherPlaybook;
}

async function handedOff(
  fetchMcp: FetchMcp,
  request: Request,
  call: Omit<OrgCall, 'dropped'> | Omit<PlaybookCall, 'dropped'>,
): Promise<Response> {
  const dropped = await droppedArgumentsOf(request);
  return fetchMcp(request, { authInfo: authInfoFor({ ...call, dropped }) });
}

function endpoint(fetchMcp: FetchMcp, scope: OperationScope): RouteHandler {
  return (c) => {
    const org = String(c.req.param('org'));
    const playbook = scope === 'playbook' ? String(c.req.param('playbook')) : undefined;
    const caller = c.get('principal').callerIn(org);
    const rejection = rejectionOf(caller, org, playbook);
    if (rejection !== undefined) {
      return problemResponse(rejection, insufficientScope);
    }
    const requestId = c.get('requestId');
    const call = playbook === undefined ? { caller, org, requestId } : { caller, org, playbook, requestId };
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
    const playbook = handlerFor(playbookServerFactory(serving), options);
    routes.add('POST', '/mcp', ownOrgEndpoint(catalog.fetch));
    routes.add('POST', '/orgs/:org/mcp', endpoint(org.fetch, 'org'));
    routes.add('POST', '/orgs/:org/playbooks/:playbook/mcp', endpoint(playbook.fetch, 'playbook'));
    routes.onClose(async () => {
      await Promise.all([catalog.close(), org.close(), playbook.close()]);
    });
  };
}
