import { issueAt, type DocumentIssue, type DocumentParts, type SourceLines } from '@beonauto/definitions/document';
import { Result } from 'effect';

import { compiledCallBlock } from '../tool-blocks/compiled-tool-block.ts';
import type { CallBlock } from '../tool-blocks/tool-block-schemas.ts';
import type { InteractionFrontMatter } from './front-matter.ts';
import type { CallDocument } from './interaction-document.ts';
import { contractOf, type Checked } from './written-parts.ts';

const callsATool = /^call:/mu;

const keysOfARequest = ['to', 'expires', 'deliver', 'replies', 'from', 'reply'] as const;

const noMessage =
  'A function with call sends no message: leave the body after the front matter empty, and say what the function does in description';

const outputNeeded = 'A function with call answers with what the tool answered, so output.schema says what that is';

export function asksASystem({ frontMatter }: Pick<DocumentParts, 'frontMatter'>): boolean {
  return callsATool.test(frontMatter);
}

function requestKeyIssues(written: InteractionFrontMatter, lines: SourceLines): readonly DocumentIssue[] {
  return keysOfARequest
    .filter((key) => written[key] !== undefined)
    .map((key) =>
      issueAt(lines, `/${key}`, `A function with call answers at once and asks no party, so it takes no ${key}`),
    );
}

function bodyIssues({ body, bodyLine }: DocumentParts): readonly DocumentIssue[] {
  const firstWritten = body.split('\n').findIndex((line) => line.trim() !== '');
  return firstWritten === -1 ? [] : [{ line: bodyLine + firstWritten, pointer: '', detail: noMessage }];
}

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

export function callFrom(
  written: InteractionFrontMatter,
  call: CallBlock,
  lines: SourceLines,
  parts: DocumentParts,
): Checked<CallDocument> {
  const input = contractOf(written.input, 'input', lines);
  const output = contractOf(written.output, 'output', lines);
  const compiled = compiledCallBlock(call, lines, Result.isSuccess(input) ? input.success.schema?.document : undefined);
  const answered = Result.flatMap(output, ({ schema }) =>
    schema === undefined ? Result.fail([issueAt(lines, '/call', outputNeeded)]) : Result.succeed({ schema }),
  );
  const issues = [
    ...requestKeyIssues(written, lines),
    ...bodyIssues(parts),
    ...issuesOf(() => compiled),
    ...issuesOf(() => input),
    ...issuesOf(() => answered),
  ];
  return issues.length > 0
    ? Result.fail(issues)
    : Result.map(Result.all({ input, output: answered }), (contracts: Pick<CallDocument, 'input' | 'output'>) => ({
        shape: 'call',
        ...(written.description === undefined ? {} : { description: written.description }),
        call,
        ...contracts,
      }));
}
