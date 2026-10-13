import { guideRoutesOf } from '../guides/guide-routes.ts';
import { guideShelfOf } from '../guides/guide-shelf.ts';
import type { McpServing } from '../mcp/mcp-connection.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { RegisterRoutes } from '../routes.ts';
import { openApiDocumentOf } from './openapi-document.ts';

export type OpenApiServing = Pick<McpServing, 'catalog' | 'serverInfo' | 'definitionTypes' | 'guides' | 'recipes'>;

export const openApiPath = `${versionPrefix}/openapi.json`;

const documentHeaders = { 'content-type': 'application/json', 'cache-control': 'no-store' };

export function openApiRoutes({
  catalog,
  serverInfo,
  definitionTypes,
  guides,
  recipes,
}: OpenApiServing): RegisterRoutes {
  const shelf = guideShelfOf(guides, recipes, definitionTypes);
  const document = JSON.stringify(openApiDocumentOf(catalog, serverInfo, shelf));
  const serveGuides = guideRoutesOf(shelf);
  return (routes) => {
    routes.add('GET', openApiPath, () => new Response(document, { headers: documentHeaders }));
    serveGuides(routes);
  };
}
