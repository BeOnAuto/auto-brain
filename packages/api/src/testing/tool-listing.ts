import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { Schema } from 'effect';

import { withBrainArgument } from '../tools/brain-argument.ts';

const ListedToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  outputSchema: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export type ListedTool = typeof ListedToolSchema.Type;

const toolsOf = Schema.decodeUnknownSync(Schema.Struct({ tools: Schema.Array(ListedToolSchema) }));

const validator = new AjvJsonSchemaValidator();

export function listedTools(listing: unknown): readonly ListedTool[] {
  return toolsOf(listing).tools;
}

export function toolNamesIn(listing: unknown): readonly string[] {
  return listedTools(listing).map(({ name }) => name);
}

export const guideToolName = 'get_guide';

export function operationToolsIn(listing: unknown): readonly ListedTool[] {
  return listedTools(listing).filter(({ name }) => name !== guideToolName);
}

export function takingBrain({ inputSchema, ...tool }: ListedTool): ListedTool {
  return { ...tool, inputSchema: withBrainArgument(inputSchema) };
}

export function schemasOf(tools: readonly ListedTool[]): readonly Readonly<Record<string, unknown>>[] {
  return tools.flatMap(({ inputSchema, outputSchema }) =>
    outputSchema === undefined ? [inputSchema] : [inputSchema, outputSchema],
  );
}

export function outputConformsTo(listing: unknown, name: string, value: unknown): boolean {
  return listedTools(listing).some(
    (tool) => tool.name === name && validator.getValidator({ ...tool.outputSchema })(value).valid,
  );
}
