import {
  bulletList,
  inputSection,
  named,
  outputSection,
  paragraph,
  sectionOf,
  type OverviewSection,
  type Phrases,
} from '@on.auto/definitions';
import { splitDocument } from '@on.auto/definitions/document';
import { readableParts } from '@on.auto/definitions/template';
import type { ToolReference } from '@on.auto/tool-servers/policy';
import { Result, type Schema } from 'effect';

import type {
  InputContract,
  ReasoningFunctionDefinitionDocument,
} from '../definition/reasoning-function-definition.ts';
import type { OutputRequest } from '../model/model-request.ts';

type Entry = readonly [string, Schema.Json];

function isRecord(value: Schema.Json | undefined): value is Schema.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withDefault([name, property]: Entry, defaults: Schema.JsonObject): Entry {
  const value = defaults[name];
  return value === undefined || !isRecord(property)
    ? [name, property]
    : [name, Object.fromEntries([...Object.entries(property), ['default', value]])];
}

function documentedInput({ schema, defaults }: InputContract): Schema.JsonObject | undefined {
  const properties = schema?.document['properties'];
  if (schema === undefined || !isRecord(properties)) {
    return schema?.document;
  }
  const withDefaults = Object.entries(properties).map((entry: Entry) => withDefault(entry, defaults));
  return Object.fromEntries([...Object.entries(schema.document), ['properties', Object.fromEntries(withDefaults)]]);
}

function producedSection(output: OutputRequest): OverviewSection {
  return output.type === 'json'
    ? outputSection(output.schema.document, output.shape)
    : sectionOf('What it produces', paragraph('Text: the answer the model writes.'));
}

function toolPhrases({ server, tool }: ToolReference): Phrases {
  return tool === '*' ? ['every tool of ', named(server)] : ['the tool ', named(tool), ' of ', named(server)];
}

function modelSection({ model, tools }: ReasoningFunctionDefinitionDocument): OverviewSection {
  const toolBlocks =
    tools.length === 0
      ? [paragraph('It calls no tools.')]
      : [paragraph('It may call these tools:'), bulletList(tools.map((tool) => toolPhrases(tool)))];
  return sectionOf(
    'Which model and tools',
    paragraph('It reasons with the model ', { code: model }, '.'),
    ...toolBlocks,
  );
}

function toldSection(source: string): OverviewSection {
  const { body, bodyLine } = Result.getOrThrow(splitDocument(source, 'A reasoning function definition'));
  const { inside, outside } = readableParts({ text: body, firstLine: bodyLine }, 'system');
  const instructions =
    inside.length === 0 ? [] : [paragraph('Its instructions, which it follows on every run:'), ...inside];
  return sectionOf(
    'What it is told',
    ...instructions,
    paragraph('Its message, with the values of each run in place of the names in bold:'),
    ...outside,
  );
}

export function reasoningOverview(
  definition: ReasoningFunctionDefinitionDocument,
  source: string,
): readonly OverviewSection[] {
  return [
    inputSection(documentedInput(definition.input)),
    producedSection(definition.output),
    modelSection(definition),
    toldSection(source),
  ];
}
