import type { McpServing } from '../mcp/mcp-connection.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { RegisterRoutes } from '../routes.ts';
import { openApiDocumentOf } from './openapi-document.ts';

export type OpenApiServing = Pick<McpServing, 'catalog' | 'serverInfo' | 'shelf'>;

export const openApiPath = `${versionPrefix}/openapi.json`;

const documentHeaders = { 'content-type': 'application/json', 'cache-control': 'no-store' };

export function openApiDocumentRoutes({ catalog, serverInfo, shelf }: OpenApiServing): RegisterRoutes {
  const document = JSON.stringify(openApiDocumentOf(catalog, serverInfo, shelf));
  return (routes) => {
    routes.addPublic('GET', openApiPath, () => new Response(document, { headers: documentHeaders }));
  };
}
