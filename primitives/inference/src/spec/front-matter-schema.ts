import { JsonPointer, Predicate, Result, Schema, SchemaIssue, type StandardSchema } from 'effect';

import type { ReasoningEffort } from '../model/model-request.ts';
import { pointerOf } from '../schema/json-bounds.ts';
import { issueAt, type DocumentIssue, type SourceLines } from './document-issue.ts';
import { readFrontMatter } from './front-matter-reading.ts';

const descriptionLength = 1000;

const reasoningEfforts = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];

const DescriptionSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(descriptionLength));

const ConfigSchema = Schema.Struct({
  max_output_tokens: Schema.optionalKey(Schema.Number),
  temperature: Schema.optionalKey(Schema.Number),
  top_p: Schema.optionalKey(Schema.Number),
  seed: Schema.optionalKey(Schema.Number),
  stop_sequences: Schema.optionalKey(Schema.Array(Schema.String)),
  reasoning: Schema.optionalKey(Schema.Literals(reasoningEfforts)),
});

const InputSectionSchema = Schema.Struct({
  schema: Schema.optionalKey(Schema.JsonObject),
  default: Schema.optionalKey(Schema.JsonObject),
});

const OutputSectionSchema = Schema.Struct({
  format: Schema.optionalKey(Schema.Literals(['text', 'json'])),
  schema: Schema.optionalKey(Schema.JsonObject),
});

const ProviderOptionsSchema = Schema.Record(Schema.String, Schema.JsonObject);

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  model: Schema.String,
  config: Schema.optionalKey(ConfigSchema),
  input: Schema.optionalKey(InputSectionSchema),
  output: Schema.optionalKey(OutputSectionSchema),
  provider_options: Schema.optionalKey(ProviderOptionsSchema),
  tools: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type ConfigSection = typeof ConfigSchema.Type | undefined;

export type InputSection = typeof InputSectionSchema.Type | undefined;

export type OutputSection = typeof OutputSectionSchema.Type | undefined;

export const decodeSection = {
  description: Schema.decodeUnknownOption(Schema.UndefinedOr(DescriptionSchema)),
  model: Schema.decodeUnknownOption(Schema.String),
  config: Schema.decodeUnknownOption(Schema.UndefinedOr(ConfigSchema)),
  input: Schema.decodeUnknownOption(Schema.UndefinedOr(InputSectionSchema)),
  output: Schema.decodeUnknownOption(Schema.UndefinedOr(OutputSectionSchema)),
  provider_options: Schema.decodeUnknownOption(Schema.UndefinedOr(ProviderOptionsSchema)),
  tools: Schema.decodeUnknownOption(Schema.UndefinedOr(Schema.Array(Schema.String))),
};

export interface ReadFrontMatter {
  readonly root: Schema.JsonObject;
  readonly lines: SourceLines;
  readonly issues: readonly DocumentIssue[];
}

interface Section {
  readonly name: 'config' | 'input' | 'output' | undefined;
  readonly keys: readonly string[];
}

const sections: readonly Section[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'config', keys: Object.keys(ConfigSchema.fields) },
  { name: 'input', keys: Object.keys(InputSectionSchema.fields) },
  { name: 'output', keys: Object.keys(OutputSectionSchema.fields) },
];

type IssueSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function isPropertyKey(segment: IssueSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function unknownKeyIssues(root: Schema.JsonObject, lines: SourceLines): readonly DocumentIssue[] {
  return sections.flatMap(({ name, keys }) => {
    const section = name === undefined ? root : root[name];
    const unknown = Predicate.isObject(section) && !Array.isArray(section) ? Object.keys(section) : [];
    return unknown
      .filter((key) => !keys.includes(key))
      .map((key) =>
        issueAt(
          lines,
          `${name === undefined ? '' : `/${name}`}/${JsonPointer.escapeToken(key)}`,
          `${key} is not a key of ${name ?? 'the front matter'}; it takes ${keys.join(', ')}`,
        ),
      );
  });
}

function detailOf(message: string, path: readonly PropertyKey[]): string {
  return message === 'Missing key' ? `${String(path.at(-1))} is required` : message;
}

function typeIssues(root: Schema.JsonObject, lines: SourceLines): readonly DocumentIssue[] {
  return Result.match(decodeFrontMatter(root), {
    onSuccess: () => [],
    onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      formatIssues(issue).issues.map(({ message, path = [] }) => {
        const keys = path.filter((segment) => isPropertyKey(segment));
        return issueAt(lines, pointerOf(keys), detailOf(message, keys));
      }),
  });
}

export function frontMatterIn(
  text: string,
  firstLine: number,
): Result.Result<ReadFrontMatter, readonly DocumentIssue[]> {
  return Result.map(readFrontMatter(text, firstLine), ({ value, lines }) => ({
    root: value,
    lines,
    issues: [...unknownKeyIssues(value, lines), ...typeIssues(value, lines)],
  }));
}
