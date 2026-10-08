import { Schema } from 'effect';

const metaField = '_meta';

const ContentBlockSchema = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
});

const ToolResultSchema = Schema.Struct({
  content: Schema.Array(ContentBlockSchema),
  structuredContent: Schema.optionalKey(Schema.Unknown),
  isError: Schema.optionalKey(Schema.Boolean),
  [metaField]: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export const ToolAnnotationsSchema = Schema.Struct({
  readOnlyHint: Schema.optionalKey(Schema.Boolean),
  destructiveHint: Schema.optionalKey(Schema.Boolean),
  idempotentHint: Schema.optionalKey(Schema.Boolean),
  openWorldHint: Schema.optionalKey(Schema.Boolean),
});

const ListedToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  inputSchema: Schema.JsonObject,
  annotations: Schema.optionalKey(ToolAnnotationsSchema),
});

export type ToolResult = typeof ToolResultSchema.Type;

export type ListedTool = typeof ListedToolSchema.Type;

export type ToolAnnotations = typeof ToolAnnotationsSchema.Type;

type ContentBlock = typeof ContentBlockSchema.Type;

export const decodeToolResult = Schema.decodeUnknownSync(ToolResultSchema);

export const decodeListedTools = Schema.decodeUnknownSync(Schema.Struct({ tools: Schema.Array(ListedToolSchema) }));

const nothing = '(The tool answered with no content.)';

const mostErrorCharacters = 300;

const mostLoggedCharacters = 2000;

export function metaValueOf(result: ToolResult, key: string): unknown {
  return result[metaField]?.[key];
}

function placeholderOf({ type, mimeType }: ContentBlock): string {
  return mimeType === undefined ? `[${type} content, not shown]` : `[${type} content (${mimeType}), not shown]`;
}

function isText(block: ContentBlock): block is ContentBlock & { readonly text: string } {
  return block.type === 'text' && block.text !== undefined;
}

export function resultText({ content, structuredContent }: ToolResult): string {
  const hasText = content.some((block) => isText(block));
  const blocks = content.map((block) => (isText(block) ? block.text : placeholderOf(block)));
  const lines = hasText || structuredContent === undefined ? blocks : [JSON.stringify(structuredContent), ...blocks];
  return lines.length === 0 ? nothing : lines.join('\n');
}

export function errorTextForModel(text: string, scrub: (text: string) => string): string {
  return scrub(text.trim()).slice(0, mostErrorCharacters);
}

export function errorTextForOperator(text: string, scrub: (text: string) => string): string {
  return scrub(text.trim()).slice(0, mostLoggedCharacters);
}
