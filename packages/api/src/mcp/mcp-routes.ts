import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import type { OperationScope } from '@on.auto/operations';

import { admissionAt } from '../authentication/endpoint-admission.ts';
import { authInfoFor, tracedBy, type PlaybookCall, type OrgCall } from '../hand-off/caller-hand-off.ts';
import { droppedArgumentsOf } from '../hand-off/dropped-arguments.ts';
import { requestBodyLimit } from '../operations/request-body.ts';
import type { RegisterRoutes, RouteHandler, Routes } from '../routes.ts';
import { linkedAnswers, type RetryStateKeys } from '../tools/linked-answers.ts';
import type { McpServing } from './mcp-connection.ts';
import {
  playbookServerFactory,
  catalogServerFactory,
  orgServerFactory,
  type McpServerFactory,
} from './mcp-server-factory.ts';

export interface McpRoutesOptions extends McpServing {
  readonly reportError: (error: Readonly<Error>) => void;
  readonly retryStateKeys: RetryStateKeys;
}

type FetchMcp = McpHttpHandler['fetch'];

type Resource = Routes['resource'];

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
    const admission = admissionAt(c.get('principal').callerIn(org), org, playbook, resource);
    if ('refused' in admission) {
      return admission.refused;
    }
    const { caller } = admission;
    const handedOver = { caller, org, requestId: c.get('requestId'), ...tracedBy(c.get('traceParent')) };
    const call = playbook === undefined ? handedOver : { ...handedOver, playbook };
    return handedOff(fetchMcp, c.req.raw, call);
  };
}

function ownOrgEndpoint(fetchMcp: FetchMcp): RouteHandler {
  return (c) => {
    const { own } = c.get('principal');
    return handedOff(fetchMcp, c.req.raw, {
      caller: own,
      org: own.org,
      requestId: c.get('requestId'),
      ...tracedBy(c.get('traceParent')),
    });
  };
}

function handlerFor(factory: McpServerFactory, { reportError }: McpRoutesOptions): McpHttpHandler {
  return createMcpHandler(factory, { legacy: 'stateless', maxRequestBodySize: requestBodyLimit, onerror: reportError });
}

export function mcpRoutes(options: McpRoutesOptions): RegisterRoutes {
  return (routes) => {
    const serving = {
      ...options,
      reportThrown: routes.reportThrown,
      linkedAnswers: linkedAnswers(options.retryStateKeys),
    };
    const catalog = handlerFor(catalogServerFactory(serving), options);
    const org = handlerFor(orgServerFactory(serving), options);
    const playbook = handlerFor(playbookServerFactory(serving), options);
    routes.add('POST', '/mcp', ownOrgEndpoint(catalog.fetch));
    routes.add('POST', '/orgs/:org/mcp', endpoint(org.fetch, 'org', routes.resource));
    routes.add('POST', '/orgs/:org/playbooks/:playbook/mcp', endpoint(playbook.fetch, 'playbook', routes.resource));
    routes.onClose(async () => {
      await Promise.all([catalog.close(), org.close(), playbook.close()]);
    });
  };
}
