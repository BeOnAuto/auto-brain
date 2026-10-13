import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { allPermissions, canAccessPlaybook, type CallerIdentity, type OperationScope } from '@on.auto/operations';

import {
  callerOfAnotherOrg,
  endpointPathOf,
  insufficientScope,
  namesAnEndpoint,
} from '../authentication/challenges.ts';
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

const noSuchOrg = problemOf('not_found', 'There is no such org');

const noSuchPlaybook = problemOf('not_found', 'There is no such playbook in this org');

type Resource = Routes['resource'];

type Admission = { readonly caller: CallerIdentity } | { readonly refusal: Problem };

function refused(problem: Problem, resource: Resource, path: string): Response {
  return problemResponse(
    problem,
    problem.reason === 'forbidden' ? insufficientScope(resource, allPermissions, path) : {},
  );
}

function admissionOf(caller: CallerIdentity | undefined, org: string, playbook: string | undefined): Admission {
  if (caller === undefined) {
    return { refusal: callerOfAnotherOrg };
  }
  if (playbook !== undefined && !canAccessPlaybook(caller.playbooks, playbook)) {
    return { refusal: anotherPlaybook };
  }
  if (!namesAnEndpoint(org)) {
    return { refusal: noSuchOrg };
  }
  return namesAnEndpoint(org, playbook) ? { caller } : { refusal: noSuchPlaybook };
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
    const admission = admissionOf(c.get('principal').callerIn(org), org, playbook);
    if ('refusal' in admission) {
      return refused(admission.refusal, resource, endpointPathOf(org, playbook));
    }
    const { caller } = admission;
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
      return refused(noOrg, resource, '/mcp');
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
