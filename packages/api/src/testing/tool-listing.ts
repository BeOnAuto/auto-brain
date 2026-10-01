import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { Schema } from 'effect';

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

export function outputConformsTo(listing: unknown, name: string, value: unknown): boolean {
  return listedTools(listing).some(
    (tool) => tool.name === name && validator.getValidator({ ...tool.outputSchema })(value).valid,
  );
}
