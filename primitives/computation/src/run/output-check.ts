import { compileJsonSchema, type SchemaIssue } from '@beonauto/specs/json-schema';
import { mostValueDepth, type OutputCheck } from '@beonauto/workflow-engine/worker';
import { Result } from 'effect';

const mostIssuesInADetail = 3;

function issueText({ pointer, detail }: SchemaIssue): string {
  return `${pointer === '' ? 'the output' : pointer}: ${detail}`;
}

function issuesOf(found: readonly SchemaIssue[]): readonly string[] {
  return found.slice(0, mostIssuesInADetail).map((issue) => issueText(issue));
}

export function outputCheckOf(schema: unknown): OutputCheck {
  return Result.match(compileJsonSchema(schema, { what: 'output', nesting: mostValueDepth }), {
    onFailure: (found) => () => issuesOf(found),
    onSuccess:
      ({ validate }) =>
      (output) =>
        Result.match(validate(output), { onFailure: issuesOf, onSuccess: () => [] }),
  });
}
