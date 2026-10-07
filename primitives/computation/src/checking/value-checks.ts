import { issuesDetail, schemaCheckOf } from '@beonauto/specs/json-schema';
import type { ValueChecks } from '@beonauto/workflow-engine/job-loop';
import { mostValueDepth, type Json, type OutputCheck, type ViewCheck } from '@beonauto/workflow-engine/worker';

export const checkedWorker = new URL('./checked-worker.ts', import.meta.url);

export function outputCheckOf(schema: Json): OutputCheck {
  return schemaCheckOf(schema, { what: 'output', nesting: mostValueDepth });
}

export function viewCheckOf(schema: Json): ViewCheck {
  const check = schemaCheckOf(schema, { what: 'view', nesting: mostValueDepth });
  return (view) => {
    const issues = check(view);
    return issues.length === 0 ? undefined : issuesDetail(issues, 'view');
  };
}

export const valueChecks: ValueChecks = { output: outputCheckOf, view: viewCheckOf };
