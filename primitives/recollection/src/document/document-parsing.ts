import {
  compileJsonSchema,
  frontMatterIn,
  issueAt,
  reportedIssues,
  splitDocument,
  type CompiledSchema,
  type DocumentIssue,
  type DocumentParts,
  type ReadFrontMatter,
  type SourceLines,
} from '@beonauto/specs/document';
import { compileProgram, jsonBytesOf, lineOf, mostValueDepth } from '@beonauto/workflow-engine/dsl';
import type { ViewFilter } from '@beonauto/workflow-host';
import { Result, type Schema } from 'effect';

import { recallBounds } from '../run/recall-bounds.ts';
import { decodeFrontMatter, recallFrontMatter, type RecallFrontMatter } from './front-matter.ts';
import { answerDialect, foldDialect } from './recall-dialects.ts';
import type { RecallAnswer, RecallFunctionDefinitionDocument, ValueContract } from './recall-document.ts';
import { filtersOf } from './source-filters.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

interface FoldPart {
  readonly fold: string;
  readonly foldLine: number;
}

interface ViewPart {
  readonly initial: Schema.Json;
  readonly schema?: CompiledSchema;
}

interface AnswerPart {
  readonly answer?: RecallAnswer;
}

type ValueSection = { readonly schema?: Schema.JsonObject } | undefined;

const language = 'jq';

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function foldOf({ body, bodyLine }: DocumentParts): Checked<FoldPart> {
  if (body.trim() === '') {
    return Result.fail([
      { line: bodyLine, pointer: '', detail: 'The definition has no fold: write it after the front matter' },
    ]);
  }
  const compiled = compileProgram(body, foldDialect);
  return 'issues' in compiled
    ? Result.fail(
        compiled.issues.map(({ detail, span }) => ({
          line: bodyLine + lineOf(body, span.start) - 1,
          pointer: '',
          detail,
        })),
      )
    : Result.succeed({ fold: body, foldLine: bodyLine });
}

function languageOf(written: string, lines: SourceLines): Checked<typeof language> {
  return written === language
    ? Result.succeed(language)
    : Result.fail([
        issueAt(lines, '/language', `${written} is not a language of a recall function; it is written in jq`),
      ]);
}

function schemaOf(document: Schema.JsonObject | undefined, what: string, lines: SourceLines): Checked<ValueContract> {
  if (document === undefined) {
    return Result.succeed({});
  }
  return Result.mapBoth(compileJsonSchema(document, { what, nesting: mostValueDepth }), {
    onSuccess: (schema) => ({ schema }),
    onFailure: (issues) => issues.map(({ pointer, detail }) => issueAt(lines, `/${what}/schema${pointer}`, detail)),
  });
}

function contractOf(section: ValueSection, name: 'input' | 'output', lines: SourceLines): Checked<ValueContract> {
  return schemaOf(section?.schema, name, lines);
}

function initialIssues(initial: Schema.Json, schema: CompiledSchema | undefined): readonly string[] {
  const bytes = jsonBytesOf(initial);
  if (bytes > recallBounds.mostViewBytes) {
    return [`initial takes ${bytes} bytes as JSON, more than the ${recallBounds.mostViewBytes} a view may`];
  }
  const checked = schema?.validate(initial);
  return checked === undefined || Result.isSuccess(checked)
    ? []
    : checked.failure.map(
        ({ pointer, detail }) =>
          `initial does not match the view's schema at ${pointer === '' ? 'its root' : pointer}: ${detail}`,
      );
}

function viewOf(front: RecallFrontMatter, lines: SourceLines): Checked<ViewPart> {
  const initial = front.view?.initial ?? null;
  return Result.flatMap(schemaOf(front.view?.schema, 'view', lines), ({ schema }) => {
    const issues = initialIssues(initial, schema).map((detail) => issueAt(lines, '/view/initial', detail));
    return issues.length > 0
      ? Result.fail(issues)
      : Result.succeed(schema === undefined ? { initial } : { initial, schema });
  });
}

function answerOf(source: string | undefined, lines: SourceLines): Checked<AnswerPart> {
  if (source === undefined) {
    return Result.succeed({});
  }
  const compiled = compileProgram(source, answerDialect);
  const { line } = issueAt(lines, '/answer', '');
  return 'issues' in compiled
    ? Result.fail(compiled.issues.map(({ detail }) => issueAt(lines, '/answer', detail)))
    : Result.succeed({ answer: { source, line } });
}

interface Parts {
  readonly language: typeof language;
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly view: ViewPart;
  readonly answer: AnswerPart;
  readonly filters: readonly ViewFilter[];
  readonly fold: FoldPart;
}

function assembled(description: string | undefined, parts: Parts): RecallFunctionDefinitionDocument {
  const { input, output, view, answer, filters, fold } = parts;
  return {
    ...(description === undefined ? {} : { description }),
    language,
    input,
    output,
    ...answer,
    details: {
      language,
      ...fold,
      ...(answer.answer === undefined ? {} : { answer: answer.answer.source }),
      filters,
      initial: view.initial,
      ...(view.schema === undefined ? {} : { schema: view.schema.document }),
    },
  };
}

function documentFrom(
  { root, lines, issues }: ReadFrontMatter,
  fold: () => Checked<FoldPart>,
): Checked<RecallFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(root);
  if (issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...issues, ...issuesOf(fold)]);
  }
  const front = decoded.success;
  const parts = {
    language: languageOf(front.language, lines),
    input: contractOf(front.input, 'input', lines),
    output: contractOf(front.output, 'output', lines),
    view: viewOf(front, lines),
    answer: answerOf(front.answer, lines),
    filters: filtersOf(front.source.events, lines),
    fold: fold(),
  };
  const found = [
    ...issuesOf(() => parts.language),
    ...issuesOf(() => parts.input),
    ...issuesOf(() => parts.output),
    ...issuesOf(() => parts.view),
    ...issuesOf(() => parts.answer),
    ...issuesOf(() => parts.filters),
    ...issuesOf(() => parts.fold),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(Result.all(parts), (checked) => assembled(front.description, checked));
}

function documentOf(parts: DocumentParts): Checked<RecallFunctionDefinitionDocument> {
  const fold = foldOf(parts);
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, recallFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...issuesOf(() => fold)])
    : documentFrom(reading.success, () => fold);
}

export function parseRecallDocument(source: string): Checked<RecallFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A recall function definition'), documentOf),
    reportedIssues,
  );
}
