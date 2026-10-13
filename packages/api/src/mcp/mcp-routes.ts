import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { allPermissions, canAccessPlaybook, type OperationScope } from '@on.auto/operations';

import { callerOfAnotherOrg, insufficientScope } from '../authentication/challenges.ts';
import { authInfoFor, type PlaybookCall, type OrgCall } from '../hand-off/caller-hand-off.ts';
import { droppedArgumentsOf } from '../hand-off/dropped-arguments.ts';
import { requestBodyLimit } from '../operations/request-body.ts';
import { problemOf, problemResponse, type Problem } from '../problem/problem.ts';
import type { RegisterRoutes, RouteHandler, Routes } from '../routes.ts';
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

const anotherPlaybook = problemOf('forbidden', 'The caller may not access this playbook');

const noOrg = problemOf('forbidden', 'The caller belongs to no org');

type Resource = Routes['resource'];

function refused(problem: Problem, resource: Resource, path: string): Response {
  return problemResponse(problem, insufficientScope(resource, allPermissions, path));
}

async function handedOff(
  fetchMcp: FetchMcp,
  request: Request,
  call: Omit<OrgCall, 'dropped'> | Omit<PlaybookCall, 'dropped'>,
): Promise<Response> {
  const dropped = await droppedArgumentsOf(request);
  return fetchMcp(request, { authInfo: authInfoFor({ ...call, dropped }) });
}

function endpoint(fetchMcp: FetchMcp, scope: OperationScope, resource: Resource): RouteHandler {
  return (c) => {
    const org = String(c.req.param('org'));
    const playbook = scope === 'playbook' ? String(c.req.param('playbook')) : undefined;
    const caller = c.get('principal').callerIn(org);
    if (caller === undefined) {
      return refused(callerOfAnotherOrg, resource, c.req.path);
    }
    if (playbook !== undefined && !canAccessPlaybook(caller.playbooks, playbook)) {
      return refused(anotherPlaybook, resource, c.req.path);
    }
    const requestId = c.get('requestId');
    const call = playbook === undefined ? { caller, org, requestId } : { caller, org, playbook, requestId };
    return handedOff(fetchMcp, c.req.raw, call);
  };
}

function ownOrgEndpoint(fetchMcp: FetchMcp, resource: Resource): RouteHandler {
  return (c) => {
    const { org, callerIn } = c.get('principal');
    const caller = org === undefined ? undefined : callerIn(org);
    if (caller === undefined) {
      return refused(noOrg, resource, c.req.path);
    }
    return handedOff(fetchMcp, c.req.raw, { caller, org: caller.org, requestId: c.get('requestId') });
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
    routes.add('POST', '/mcp', ownOrgEndpoint(catalog.fetch, routes.resource));
    routes.add('POST', '/orgs/:org/mcp', endpoint(org.fetch, 'org', routes.resource));
    routes.add('POST', '/orgs/:org/playbooks/:playbook/mcp', endpoint(playbook.fetch, 'playbook', routes.resource));
    routes.onClose(async () => {
      await Promise.all([catalog.close(), org.close(), playbook.close()]);
    });
  };
}
