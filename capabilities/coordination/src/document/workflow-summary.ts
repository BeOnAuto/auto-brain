import type { DefinitionSummary } from '@on.auto/definitions';
import { type JsonObject, objectField, textField } from '@on.auto/workflow-engine';

import { definitionsCalledIn } from './workflow-functions.ts';
import { outputShapeOf } from './workflow-output.ts';
import { triggersOfDocument } from './workflow-schedule.ts';

function detailsOf(document: JsonObject): Pick<DefinitionSummary, 'details'> {
  const calls = definitionsCalledIn(document);
  const shape = outputShapeOf(document);
  const details = { ...(calls.length === 0 ? {} : { calls }), ...(shape === undefined ? {} : { shape: shape.name }) };
  return Object.keys(details).length === 0 ? {} : { details };
}

export function summaryOf(document: JsonObject): DefinitionSummary {
  const header = objectField(document, 'document') ?? {};
  const description = textField(header, 'summary') ?? textField(header, 'title');
  const inputSchema = inlineSchemaOf(document, 'input');
  const outputSchema = outputShapeOf(document)?.schema ?? inlineSchemaOf(document, 'output');
  const triggers = triggersOfDocument(document);
  return {
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...(triggers.length === 0 ? {} : { triggers }),
    ...detailsOf(document),
  };
}

function inlineSchemaOf(document: JsonObject, part: string): JsonObject | undefined {
  return objectField(objectField(objectField(document, part) ?? {}, 'schema') ?? {}, 'document');
}
