import { compileJsonSchema, type SchemaIssue } from '@beonauto/specs/json-schema';
import { mostValueDepth, type OutputCheck, type ViewCheck } from '@beonauto/workflow-engine/worker';
import { Result } from 'effect';

const mostIssuesInADetail = 3;

function issuesOf(found: readonly SchemaIssue[]): readonly SchemaIssue[] {
  return found.slice(0, mostIssuesInADetail);
}

function checkOf(schema: unknown, what: string): (value: unknown) => readonly SchemaIssue[] {
  return Result.match(compileJsonSchema(schema, { what, nesting: mostValueDepth }), {
    onFailure: (found) => () => issuesOf(found),
    onSuccess:
      ({ validate }) =>
      (value) =>
        Result.match(validate(value), { onFailure: issuesOf, onSuccess: () => [] }),
  });
}

export function outputCheckOf(schema: unknown): OutputCheck {
  return checkOf(schema, 'output');
}

export function viewCheckOf(schema: unknown): ViewCheck {
  const check = checkOf(schema, 'view');
  return (view) => {
    const issues = check(view).map(({ pointer, detail }) => `${pointer === '' ? 'the view' : pointer}: ${detail}`);
    return issues.length === 0 ? undefined : issues.join('; ');
  };
}
