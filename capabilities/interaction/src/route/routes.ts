import type { ToolReference } from '@beonauto/mcp/policy';

import type { Replies } from './route-schemas.ts';

export interface RecordedBlocks {
  readonly deliver?: ToolReference | undefined;
  readonly replies?: Replies | undefined;
}

export type Route =
  | { readonly kind: 'inbox' }
  | { readonly kind: 'tool'; readonly delivery: ToolReference; readonly replies?: Replies };

const inbox: Route = { kind: 'inbox' };

export function routeOf({ deliver, replies }: RecordedBlocks): Route {
  if (deliver === undefined) {
    return inbox;
  }
  const delivery = { server: deliver.server, tool: deliver.tool };
  return replies === undefined ? { kind: 'tool', delivery } : { kind: 'tool', delivery, replies };
}

export function throughWords(route: Route): string {
  return route.kind === 'inbox'
    ? 'in the inbox'
    : `through the tool ${route.delivery.tool} of ${route.delivery.server}`;
}

export function toolsOf(route: Route): readonly ToolReference[] {
  if (route.kind === 'inbox') {
    return [];
  }
  const { delivery, replies } = route;
  const tools = [delivery.tool, replies?.tool, replies?.tell?.tool].filter((tool) => tool !== undefined);
  return [...new Set(tools)].map((tool) => ({ server: delivery.server, tool }));
}
