import { canAccessBrain, type CallerIdentity, type OperationScope } from '@beonauto/operations';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';

import { requestBodyLimit } from '../operations/request-body.ts';
import { problemOf, problemResponse, type Problem } from '../problem/problem.ts';
import type { RegisterRoutes, RouteHandler } from '../routes.ts';
import { authInfoFor } from './caller-hand-off.ts';
import { brainServerFactory, orgServerFactory, type McpServerFactory, type McpServing } from './mcp-server-factory.ts';

export interface McpRoutesOptions extends McpServing {
  readonly reportError: (error: Readonly<Error>) => void;
}

type FetchMcp = McpHttpHandler['fetch'];

const insufficientScope = { 'www-authenticate': 'Bearer error="insufficient_scope"' };

const anotherOrg = problemOf('forbidden', 'The caller does not belong to this org');

const anotherBrain = problemOf('forbidden', 'The caller may not access this brain');

function rejectionOf(caller: CallerIdentity, org: string, brain: string | undefined): Problem | undefined {
  if (caller.org !== org) {
    return anotherOrg;
  }
  return brain === undefined || canAccessBrain(caller.brains, brain) ? undefined : anotherBrain;
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
    return fetchMcp(c.req.raw, { authInfo: authInfoFor(call) });
  };
}

function handlerFor(factory: McpServerFactory, { reportError }: McpRoutesOptions): McpHttpHandler {
  return createMcpHandler(factory, { legacy: 'stateless', maxRequestBodySize: requestBodyLimit, onerror: reportError });
}

export function mcpRoutes(options: McpRoutesOptions): RegisterRoutes {
  return (routes) => {
    const serving = { ...options, reportThrown: routes.reportThrown };
    const org = handlerFor(orgServerFactory(serving), options);
    const brain = handlerFor(brainServerFactory(serving), options);
    routes.add('POST', '/orgs/:org/mcp', endpoint(org.fetch, 'org'));
    routes.add('POST', '/orgs/:org/brains/:brain/mcp', endpoint(brain.fetch, 'brain'));
    routes.onClose(async () => {
      await Promise.all([org.close(), brain.close()]);
    });
  };
}
