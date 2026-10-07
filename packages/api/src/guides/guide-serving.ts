import type { McpServer } from '@modelcontextprotocol/server';

import { serveGuideResources } from './guide-resources.ts';
import type { GuideShelf } from './guide-shelf.ts';
import { serveGuideTool } from './guide-tool.ts';
import { serveRecipePrompts } from './recipe-prompts.ts';

export type GuideRegistry = Readonly<Pick<McpServer, 'registerTool' | 'registerResource' | 'registerPrompt'>>;

export function serveGuides(server: GuideRegistry, shelf: GuideShelf): void {
  serveGuideTool(server, shelf);
  serveGuideResources(server, shelf);
  serveRecipePrompts(server, shelf);
}
