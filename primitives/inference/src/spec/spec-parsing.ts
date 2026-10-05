import { Option, Result, type Schema } from 'effect';

import type { CompiledTemplate } from '../template/compiled-template.ts';
import { reportedIssues, type DocumentIssue } from './document-issue.ts';
import { splitDocument, type DocumentParts } from './document-split.ts';
import { decodeSection, frontMatterIn, type ReadFrontMatter } from './front-matter-schema.ts';
import type { InferenceSpec } from './inference-spec.ts';
import { inputContractOf, outputContractOf } from './spec-schemas.ts';
import { modelOf, providerOptionsOf, settingsOf, toolsOf } from './spec-settings.ts';
import { templateOf } from './spec-template.ts';
import { variableIssues } from './template-checks.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

function checkedSection<A, B>(decoded: () => Option.Option<A>, check: (section: A) => Checked<B>): Checked<B> {
  return Option.match(decoded(), { onNone: () => Result.fail([]), onSome: check });
}

function issuesOf(...checks: readonly (() => Checked<unknown>)[]): readonly DocumentIssue[] {
  return checks.flatMap((check) => {
    const checked = check();
    return Result.isFailure(checked) ? checked.failure : [];
  });
}

function variablesOf(
  compiled: () => Checked<CompiledTemplate>,
  inputSchema: Schema.JsonObject | undefined,
): readonly DocumentIssue[] {
  const template = compiled();
  return Result.isSuccess(template) ? variableIssues(template.success.variables, inputSchema) : [];
}

function specFrom({ root, lines, issues }: ReadFrontMatter, template: () => Checked<CompiledTemplate>) {
  const model = checkedSection(
    () => decodeSection.model(root['model']),
    (reference) => modelOf(reference, lines),
  );
  const settings = checkedSection(
    () => decodeSection.config(root['config']),
    (config) => settingsOf(config, lines),
  );
  const input = checkedSection(
    () => decodeSection.input(root['input']),
    (section) => inputContractOf(section, lines),
  );
  const output = checkedSection(
    () => decodeSection.output(root['output']),
    (section) => outputContractOf(section, lines),
  );
  const description = checkedSection(() => decodeSection.description(root['description']), Result.succeed);
  const providerOptions = checkedSection(
    () => decodeSection.provider_options(root['provider_options']),
    (options) => providerOptionsOf(options, lines),
  );
  const tools = checkedSection(
    () => decodeSection.tools(root['tools']),
    (written) => toolsOf(written, lines),
  );
  const found = [
    ...issues,
    ...issuesOf(
      () => model,
      () => settings,
      () => input,
      () => output,
      () => providerOptions,
      () => tools,
      () => template(),
    ),
    ...variablesOf(template, Result.isSuccess(input) ? input.success.schema?.document : undefined),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.all({ model, settings, input, output, template: template(), description, providerOptions, tools });
}

function specOf(parts: DocumentParts): Checked<InferenceSpec> {
  const template = templateOf(parts);
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine);
  if (Result.isFailure(reading)) {
    return Result.fail([...reading.failure, ...issuesOf(() => template)]);
  }
  return Result.map(
    specFrom(reading.success, () => template),
    (spec) => ({
      ...(spec.description === undefined ? {} : { description: spec.description }),
      model: spec.model,
      settings: spec.settings,
      input: spec.input,
      output: spec.output.output,
      ...(spec.providerOptions === undefined ? {} : { provider_options: spec.providerOptions }),
      tools: spec.tools,
      template: spec.template,
      warnings: spec.output.warnings,
    }),
  );
}

export function parseSpecDocument(source: string): Checked<InferenceSpec> {
  return Result.mapError(Result.flatMap(splitDocument(source), specOf), reportedIssues);
}
