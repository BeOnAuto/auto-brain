import {
  compileJsonSchema,
  frontMatterIn,
  issueAt,
  reportedIssues,
  splitDocument,
  type DocumentIssue,
  type DocumentParts,
  type ReadFrontMatter,
  type SourceLines,
} from '@beonauto/specs/document';
import type { ParsedTemplate } from '@beonauto/specs/template';
import { mostValueDepth } from '@beonauto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import type { WrittenRoute } from '../route/compiled-route.ts';
import { expiryOf } from './expiry.ts';
import { decodeFrontMatter, interactionFrontMatter, type InteractionFrontMatter } from './front-matter.ts';
import type { InteractionFunctionDefinitionDocument, ValueContract } from './interaction-document.ts';
import { compiledTemplate } from './request-templates.ts';
import { routeIn } from './route-parts.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

type ValueSection = { readonly schema?: Schema.JsonObject } | undefined;

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function messageOf({ body, bodyLine }: DocumentParts, inputSchema?: Schema.JsonObject) {
  if (body.trim() === '') {
    return Result.fail([
      { line: bodyLine, pointer: '', detail: 'The definition has no message: write it after the front matter' },
    ]);
  }
  return compiledTemplate(body, { line: bodyLine, pointer: '', what: 'the message of a request' }, inputSchema);
}

function contractOf(section: ValueSection, name: 'input' | 'output', lines: SourceLines): Checked<ValueContract> {
  const document = section?.schema;
  if (document === undefined) {
    return Result.succeed({});
  }
  return Result.mapBoth(compileJsonSchema(document, { what: name, nesting: mostValueDepth }), {
    onSuccess: (schema) => ({ schema }),
    onFailure: (issues) => issues.map(({ pointer, detail }) => issueAt(lines, `/${name}/schema${pointer}`, detail)),
  });
}

function expiresOf(written: string, lines: SourceLines): Checked<number> {
  return Result.mapError(expiryOf(written), (detail) => [issueAt(lines, '/expires', detail)]);
}

interface CheckedParts {
  readonly route: Checked<WrittenRoute | null>;
  readonly expires: Checked<number>;
  readonly input: Checked<ValueContract>;
  readonly output: Checked<ValueContract>;
  readonly to: Checked<ParsedTemplate>;
  readonly message: Checked<ParsedTemplate>;
}

function partsOf(written: InteractionFrontMatter, { lines }: ReadFrontMatter, parts: DocumentParts): CheckedParts {
  const input = contractOf(written.input, 'input', lines);
  const inputSchema = Result.isSuccess(input) ? input.success.schema?.document : undefined;
  const toLine = issueAt(lines, '/to', '').line;
  return {
    route: routeIn(written, lines, inputSchema),
    expires: expiresOf(written.expires, lines),
    input,
    output: contractOf(written.output, 'output', lines),
    to: compiledTemplate(written.to, { line: toLine, pointer: '/to', what: 'the party of a request' }, inputSchema),
    message: messageOf(parts, inputSchema),
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
    ...issuesOf(() => checked.message),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(
        Result.all({
          route: checked.route,
          expires: checked.expires,
          input: checked.input,
          output: checked.output,
          to: checked.to,
          message: checked.message,
        }),
        ({ route, expires, input, output, to, message }) => ({
          ...(written.description === undefined ? {} : { description: written.description }),
          ...(route === null ? {} : { route }),
          to,
          expires: written.expires,
          expiresMs: expires,
          input,
          output,
          message,
        }),
      );
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
