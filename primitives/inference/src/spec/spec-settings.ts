import { Option, Result } from 'effect';

import { parseModelReference } from '../model/model-reference.ts';
import type { GenerationSettings } from '../model/model-request.ts';
import { requestIssues } from '../model/request-checks.ts';
import { issueAt, type DocumentIssue, type SourceLines } from './document-issue.ts';
import type { ConfigSection } from './front-matter-schema.ts';

const defaultOutputTokens = 1024;

const mostOutputTokens = 64_000;

const settingsPointer = /^\/settings/u;

export function modelOf(model: string, lines: SourceLines): Result.Result<string, readonly DocumentIssue[]> {
  return Option.isNone(parseModelReference(model))
    ? Result.fail([issueAt(lines, '/model', 'Expected provider/model, for example anthropic/claude-sonnet-4-5')])
    : Result.succeed(model);
}

export function settingsOf(
  config: ConfigSection,
  lines: SourceLines,
): Result.Result<GenerationSettings, readonly DocumentIssue[]> {
  const { max_output_tokens = defaultOutputTokens, ...others } = config ?? {};
  const settings = { max_output_tokens, ...others };
  const issues = [
    ...requestIssues({
      model: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: '' }] }],
      output: { type: 'text' },
      settings,
    }).map(({ pointer, detail }) => issueAt(lines, pointer.replace(settingsPointer, '/config'), detail)),
    ...(max_output_tokens > mostOutputTokens
      ? [issueAt(lines, '/config/max_output_tokens', `Expected at most ${mostOutputTokens}`)]
      : []),
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(settings);
}
