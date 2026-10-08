import type { DocumentIssue, SourceLines } from '@beonauto/specs/document';
import { issueAt } from '@beonauto/specs/document';
import type { ParsedTemplate } from '@beonauto/specs/template';
import { Result, type Schema } from 'effect';

import type { ReplyRule, WrittenRule } from '../replies/reply-rule.ts';
import { checkedRule } from '../replies/rule-checks.ts';
import { compiledTemplate } from './request-templates.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

export function fromOf(
  written: string | undefined,
  lines: SourceLines,
  inputSchema: Schema.JsonObject | undefined,
): Checked<ParsedTemplate | null> {
  if (written === undefined) {
    return Result.succeed(null);
  }
  const line = issueAt(lines, '/from', '').line;
  return compiledTemplate(written, { line, pointer: '/from', what: 'the party whose reply counts' }, inputSchema);
}

export function replyOf(
  written: WrittenRule | undefined,
  answerSchema: Schema.JsonObject | undefined,
  lines: SourceLines,
): Checked<ReplyRule | null> {
  return Result.mapError(checkedRule(written, answerSchema), (issues) =>
    issues.map(({ pointer, detail }) => issueAt(lines, pointer, detail)),
  );
}
