import type { SpecSummary } from '@beonauto/specs';
import { objectField, textField, type JsonObject } from '@beonauto/workflow-engine/dsl/json';

export function summaryOf(document: JsonObject): SpecSummary {
  const header = objectField(document, 'document') ?? {};
  const description = textField(header, 'summary') ?? textField(header, 'title');
  const inputSchema = inlineSchemaOf(document, 'input');
  const outputSchema = inlineSchemaOf(document, 'output');
  return {
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
  };
}

function inlineSchemaOf(document: JsonObject, part: string): JsonObject | undefined {
  return objectField(objectField(objectField(document, part) ?? {}, 'schema') ?? {}, 'document');
}
