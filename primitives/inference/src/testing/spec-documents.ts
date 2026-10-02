import { Result } from 'effect';

import { issueText } from '../spec/document-issue.ts';
import type { InferenceSpec } from '../spec/inference-spec.ts';
import { parseSpecDocument } from '../spec/spec-parsing.ts';

export function documentOf(frontMatter: string, body = 'Summarize {{ input.text }}'): string {
  return `---\n${frontMatter}\n---\n${body}`;
}

export function parsed(source: string): InferenceSpec {
  return Result.getOrThrow(parseSpecDocument(source));
}

export function issuesIn(source: string): readonly string[] {
  return Result.match(parseSpecDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}
