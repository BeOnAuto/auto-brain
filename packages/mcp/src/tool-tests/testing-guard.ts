import type { ToolAnnotations } from '../bounds/result-text.ts';
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
