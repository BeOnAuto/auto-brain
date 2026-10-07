import { rejected, type Issue } from '@beonauto/operations';
import type { CallToolResult, McpServer, StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';
import { Result, Schema, SchemaIssue, type SchemaAST } from 'effect';

import { unsuccessfulResultOf } from '../tools/tool-result.ts';
import { advertisedSchema } from '../tools/tool-schema.ts';
import type { GuideShelf } from './guide-shelf.ts';

export const guideToolName = 'get_guide';

interface GuideToolDefinition {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: StandardSchemaWithJSON;
  readonly annotations: ToolAnnotations;
}

const description = [
  "Reads one of the brain's guides: what its words mean, how each kind of definition is written, with its format, examples and bounds, and how the common tasks are done.",
  'A format guide is read before a definition of that type is written, and a recipe before the task it names.',
  '`guide` names one of them, and the answer is its whole text in Markdown.',
].join(' ');

const guideArgument =
  'The guide to read: the terminology, the format of a definition type, or a recipe for a common task';

const strictly: SchemaAST.ParseOptions = { onExcessProperty: 'error', errors: 'all' };

const failureOf = SchemaIssue.makeFormatterStandardSchemaV1();

function guideToolDefinitionOf({ everyGuide }: GuideShelf): GuideToolDefinition {
  return {
    title: 'Get guide',
    description,
    inputSchema: advertisedSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        guide: { type: 'string', enum: everyGuide.map(({ name }) => name), description: guideArgument },
      },
      required: ['guide'],
      additionalProperties: false,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
}

const decodeGuideInput = Schema.decodeUnknownResult(Schema.Struct({ guide: Schema.String }));

function pointerOf(path: readonly unknown[]): string {
  return path.map((segment) => `/${String(segment)}`).join('');
}

function refused(issues: readonly Issue[]): CallToolResult {
  return unsuccessfulResultOf(
    rejected('invalid_input', 'The input does not match the input schema', issues),
    false,
    'query',
    'read the guide',
  );
}

function guideReader({ named }: GuideShelf): (input: unknown) => CallToolResult {
  return (input) => {
    const decoded = decodeGuideInput(input, strictly);
    if (Result.isFailure(decoded)) {
      return refused(
        failureOf(decoded.failure.issue).issues.map(({ message, path = [] }) => ({
          detail: message,
          pointer: pointerOf(path),
        })),
      );
    }
    const guide = named(decoded.success.guide);
    return guide === undefined
      ? refused([{ detail: `There is no guide ${decoded.success.guide}`, pointer: '/guide' }])
      : { content: [{ type: 'text', text: guide.text }] };
  };
}

export function serveGuideTool(server: Readonly<Pick<McpServer, 'registerTool'>>, shelf: GuideShelf): void {
  server.registerTool(guideToolName, guideToolDefinitionOf(shelf), guideReader(shelf));
}
