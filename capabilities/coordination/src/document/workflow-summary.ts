import type { DefinitionSummary } from '@on.auto/definitions';
import { type JsonObject, objectField, textField } from '@on.auto/workflow-engine';

import { definitionsCalledIn } from './workflow-functions.ts';
import { triggersOfDocument } from './workflow-schedule.ts';

export function summaryOf(document: JsonObject): DefinitionSummary {
  const header = objectField(document, 'document') ?? {};
  const description = textField(header, 'summary') ?? textField(header, 'title');
  const inputSchema = inlineSchemaOf(document, 'input');
  const outputSchema = inlineSchemaOf(document, 'output');
  const triggers = triggersOfDocument(document);
  const calls = definitionsCalledIn(document);
  return {
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...(triggers.length === 0 ? {} : { triggers }),
    ...(calls.length === 0 ? {} : { details: { calls } }),
  };
}

function inlineSchemaOf(document: JsonObject, part: string): JsonObject | undefined {
  return objectField(objectField(objectField(document, part) ?? {}, 'schema') ?? {}, 'document');
}
