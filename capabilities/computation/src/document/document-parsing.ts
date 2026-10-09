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
} from '@beonauto/definitions/document';
import { compileProgram, lineOf, mostValueDepth } from '@beonauto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import type { ComputationFunctionDefinitionDocument, ValueContract } from './computation-document.ts';
import { computationFrontMatter, decodeFrontMatter } from './front-matter.ts';
import { computationDialect } from './program-dialect.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

interface ProgramPart {
  readonly program: string;
  readonly programLine: number;
}

type ValueSection = { readonly schema?: Schema.JsonObject } | undefined;

const language = 'jq';

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function programOf({ body, bodyLine }: DocumentParts): Checked<ProgramPart> {
  if (body.trim() === '') {
    return Result.fail([
      { line: bodyLine, pointer: '', detail: 'The definition has no program: write it after the front matter' },
    ]);
  }
  const compiled = compileProgram(body, computationDialect);
  return 'issues' in compiled
    ? Result.fail(
        compiled.issues.map(({ detail, span }) => ({
          line: bodyLine + lineOf(body, span.start) - 1,
          pointer: '',
          detail,
        })),
      )
    : Result.succeed({ program: body, programLine: bodyLine });
}

function languageOf(written: string, lines: SourceLines): Checked<typeof language> {
  return written === language
    ? Result.succeed(language)
    : Result.fail([
        issueAt(lines, '/language', `${written} is not a language of a computation function; it is written in jq`),
      ]);
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

function documentFrom(
  { root, lines, issues }: ReadFrontMatter,
  program: () => Checked<ProgramPart>,
): Checked<ComputationFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(root);
  if (issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...issues, ...issuesOf(program)]);
  }
  const { description, input, output } = decoded.success;
  const parts = {
    language: languageOf(decoded.success.language, lines),
    input: contractOf(input, 'input', lines),
    output: contractOf(output, 'output', lines),
    program: program(),
  };
  const found = [
    ...issuesOf(() => parts.language),
    ...issuesOf(() => parts.input),
    ...issuesOf(() => parts.output),
    ...issuesOf(() => parts.program),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(Result.all(parts), (checked) => ({
        ...(description === undefined ? {} : { description }),
        language: checked.language,
        input: checked.input,
        output: checked.output,
        ...checked.program,
      }));
}

function documentOf(parts: DocumentParts): Checked<ComputationFunctionDefinitionDocument> {
  const program = programOf(parts);
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, computationFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...issuesOf(() => program)])
    : documentFrom(reading.success, () => program);
}

export function parseComputationDocument(source: string): Checked<ComputationFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A computation function definition'), documentOf),
    reportedIssues,
  );
}
