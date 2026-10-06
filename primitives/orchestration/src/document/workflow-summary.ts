import type { DefinitionSummary } from '@beonauto/specs';
import { field, type JsonObject, objectField, textField } from '@beonauto/workflow-engine';

export function summaryOf(document: JsonObject): DefinitionSummary {
  const header = objectField(document, 'document') ?? {};
  const description = textField(header, 'summary') ?? textField(header, 'title');
  const inputSchema = inlineSchemaOf(document, 'input');
  const outputSchema = inlineSchemaOf(document, 'output');
  return {
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...(field(document, 'schedule') === undefined ? {} : { reacts: true }),
  };
}

function inlineSchemaOf(document: JsonObject, part: string): JsonObject | undefined {
  return objectField(objectField(objectField(document, part) ?? {}, 'schema') ?? {}, 'document');
}
