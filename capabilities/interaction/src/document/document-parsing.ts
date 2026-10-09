import {
  frontMatterIn,
  reportedIssues,
  splitDocument,
  type DocumentIssue,
  type DocumentParts,
  type ReadFrontMatter,
} from '@beonauto/definitions/document';
import type { ParsedTemplate } from '@beonauto/definitions/template';
import { Result } from 'effect';

import type { ReplyRule } from '../replies/reply-rule.ts';
import type { WrittenRoute } from '../route/compiled-route.ts';
import { decodeFrontMatter, interactionFrontMatter, type InteractionFrontMatter } from './front-matter.ts';
import type { InteractionFunctionDefinitionDocument, ValueContract } from './interaction-document.ts';
import { fromOf, replyOf } from './reply-parts.ts';
import { routeIn } from './route-parts.ts';
import { contractOf, expiresOf, messageOf, toOf, type Checked } from './written-parts.ts';

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

type CheckedParts = {
  readonly route: Checked<WrittenRoute | null>;
  readonly expires: Checked<number>;
  readonly input: Checked<ValueContract>;
  readonly output: Checked<ValueContract>;
  readonly to: Checked<ParsedTemplate>;
  readonly from: Checked<ParsedTemplate | null>;
  readonly message: Checked<ParsedTemplate>;
  readonly reply: Checked<ReplyRule | null>;
};

function partsOf(written: InteractionFrontMatter, { lines }: ReadFrontMatter, parts: DocumentParts): CheckedParts {
  const input = contractOf(written.input, 'input', lines);
  const output = contractOf(written.output, 'output', lines);
  const inputSchema = Result.isSuccess(input) ? input.success.schema?.document : undefined;
  return {
    route: routeIn(written, lines, inputSchema),
    expires: expiresOf(written.expires, lines),
    input,
    output,
    to: toOf(written.to, lines, inputSchema),
    from: fromOf(written.from, lines, inputSchema),
    message: messageOf(parts, inputSchema),
    reply: Result.isFailure(output)
      ? Result.succeed(null)
      : replyOf(
          {
            reply: written.reply,
            answerSchema: output.success.schema?.document,
            readsReplies: written.replies !== undefined,
          },
          lines,
        ),
  };
}

type DoneParts = { readonly [Part in keyof CheckedParts]: Result.Result.Success<CheckedParts[Part]> };

function documentOfParts(written: InteractionFrontMatter, done: DoneParts): InteractionFunctionDefinitionDocument {
  const { route, expires, input, output, to, from, message, reply } = done;
  return {
    ...(written.description === undefined ? {} : { description: written.description }),
    ...(route === null ? {} : { route }),
    to,
    ...(from === null ? {} : { from }),
    expires: written.expires,
    expiresMs: expires,
    input,
    output,
    message,
    ...(reply === null ? {} : { reply }),
  };
}

function documentFrom(reading: ReadFrontMatter, parts: DocumentParts): Checked<InteractionFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(reading.root);
  if (reading.issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...reading.issues, ...issuesOf(() => messageOf(parts))]);
  }
  const written = decoded.success;
  const checked = partsOf(written, reading, parts);
  const found = [
    ...issuesOf(() => checked.route),
    ...issuesOf(() => checked.expires),
    ...issuesOf(() => checked.input),
    ...issuesOf(() => checked.output),
    ...issuesOf(() => checked.to),
    ...issuesOf(() => checked.from),
    ...issuesOf(() => checked.message),
    ...issuesOf(() => checked.reply),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(Result.all(checked), (done) => documentOfParts(written, done));
}

function documentOf(parts: DocumentParts): Checked<InteractionFunctionDefinitionDocument> {
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, interactionFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...issuesOf(() => messageOf(parts))])
    : documentFrom(reading.success, parts);
}

export function parseInteractionDocument(source: string): Checked<InteractionFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'An interaction function definition'), documentOf),
    reportedIssues,
  );
}
