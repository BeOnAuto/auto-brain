import { isReadOnly, type ListedTool, type ToolAnnotations } from '../bounds/result-text.ts';
import { allowsTool } from '../names/tool-reference.ts';
import type { McpServerSettings, ToolLists } from '../settings/mcp-settings.ts';

export function canBeTested(tool: string, annotations: ToolAnnotations | undefined, lists: ToolLists): boolean {
  return allowsTool(lists.allowed, tool) && (isReadOnly(annotations) || lists.testable.includes(tool));
}

function offersNothingTestable({ allowed, testable }: ToolLists, tools: readonly ListedTool[]): boolean {
  return (
    testable.length === 0 &&
    !tools.some(({ name, annotations }) => allowsTool(allowed, name) && isReadOnly(annotations))
  );
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
