import type { ListedTool, ToolAnnotations } from '../bounds/result-text.ts';
import { allowsTool } from '../names/tool-reference.ts';
import type { McpServerSettings, ToolLists } from '../settings/mcp-settings.ts';

export function canBeTested(tool: string, annotations: ToolAnnotations | undefined, lists: ToolLists): boolean {
  return allowsTool(lists.allowed, tool) && (annotations?.readOnlyHint === true || lists.testable.includes(tool));
}

function offersNothingTestable({ testable }: ToolLists, tools: readonly ListedTool[]): boolean {
  return testable.length === 0 && !tools.some(({ annotations }) => annotations?.readOnlyHint === true);
}

export function untestableNoting(
  report: (server: string) => void,
): (server: McpServerSettings, tools: readonly ListedTool[]) => void {
  const noted = new Set<string>();
  return (server, tools) => {
    if (!noted.has(server.name) && offersNothingTestable(server, tools)) {
      noted.add(server.name);
      report(server.name);
    }
  };
}
