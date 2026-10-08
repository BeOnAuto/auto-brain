import { issueText } from '@beonauto/specs/document';
import { Result } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../spec/reasoning-function-definition.ts';
import { parseSpecDocument } from '../spec/spec-parsing.ts';

export const reasoningExample = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes an account',
  'config: {max_output_tokens: 800, temperature: 0.2}',
  'input:',
  '  schema: {type: object, properties: {account: {type: string}}, required: [account]}',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {summary: {type: string}}, required: [summary], additionalProperties: false}',
  '---',
  '{% system %}You write for a sales team.{% endsystem %}',
  'Summarize {{ input.account }} as of {{ today }}.',
].join('\n');

export function documentOf(frontMatter: string, body = 'Summarize {{ input.text }}'): string {
  return `---\n${frontMatter}\n---\n${body}`;
}

export function parsed(source: string): ReasoningFunctionDefinitionDocument {
  return Result.getOrThrow(parseSpecDocument(source));
}

export function issuesIn(source: string): readonly string[] {
  return Result.match(parseSpecDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}
