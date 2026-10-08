import type { ListedTool, ToolAnnotations } from '../bounds/result-text.ts';
import { isAllowed, type ToolReference } from '../names/tool-reference.ts';

export interface TestingLists {
  readonly allowed: readonly ToolReference[] | null;
  readonly testable: readonly ToolReference[];
}

export function canBeTested(
  reference: ToolReference,
  annotations: ToolAnnotations | undefined,
  { allowed, testable }: TestingLists,
): boolean {
  return isAllowed(reference, allowed) && (annotations?.readOnlyHint === true || isAllowed(reference, testable));
}

export function offersNothingTestable(
  server: string,
  tools: readonly ListedTool[],
  testable: readonly ToolReference[],
): boolean {
  return (
    !tools.some(({ annotations }) => annotations?.readOnlyHint === true) &&
    !testable.some((reference) => reference.server === server)
  );
}

export function untestableNoting(
  testable: readonly ToolReference[],
  report: (server: string) => void,
): (server: string, tools: readonly ListedTool[]) => void {
  const noted = new Set<string>();
  return (server, tools) => {
    if (!noted.has(server) && offersNothingTestable(server, tools, testable)) {
      noted.add(server);
      report(server);
    }
  };
}
