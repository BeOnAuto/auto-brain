import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { Schema } from 'effect';

import { withBrainArgument } from '../mcp/brain-argument.ts';

const ListedToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  outputSchema: Schema.Record(Schema.String, Schema.Unknown),
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

export function takingBrain({ description = '', inputSchema, ...tool }: ListedTool): ListedTool {
  return {
    ...tool,
    description: `${description} \`brain\` is the id of the brain to act in.`,
    inputSchema: withBrainArgument(inputSchema),
  };
}

export function outputConformsTo(listing: unknown, name: string, value: unknown): boolean {
  return listedTools(listing).some(
    (tool) => tool.name === name && validator.getValidator({ ...tool.outputSchema })(value).valid,
  );
}
