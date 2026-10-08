import { isServerName, isToolName, serverNameShape, toolNameShape } from '@beonauto/mcp/policy';
import { issueAt, type DocumentIssue, type SourceLines } from '@beonauto/specs/document';
import { readDuration } from '@beonauto/workflow-engine/dsl';
import { JsonPointer, Result, type Schema } from 'effect';

import { isJsonPointer } from './json-pointers.ts';
import type { Replies, ToolDelivery } from './route-schemas.ts';
import { templateIssues, templatesIssues, type TemplatePlace } from './route-templates.ts';
import { conversationTemplates, deliveryTemplates, readingTemplates, tellingTemplates } from './template-sets.ts';

export interface WrittenRoute {
  readonly deliver: ToolDelivery;
  readonly replies?: Replies | undefined;
}

const replyWaitBounds = { leastMs: 5000, mostMs: 3_600_000 } as const;

const pointerWords =
  'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1';

const waitWords = 'Expected an ISO 8601 duration from PT5S to PT1H, such as PT1M';

function placeOf(...path: readonly string[]): string {
  return path.map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('');
}

function nameIssues(
  lines: SourceLines,
  names: readonly (readonly [string, string | undefined])[],
  valid: (name: string) => boolean,
  shape: string,
) {
  return names
    .filter(([, name]) => name !== undefined && !valid(name))
    .map(([pointer]) => issueAt(lines, pointer, `Expected ${shape}`));
}

function isPointerIntoAnswer(pointer: string): boolean {
  return pointer !== '' && isJsonPointer(pointer);
}

function pointerIssues(lines: SourceLines, pointers: readonly (readonly [string, string | undefined])[]) {
  return pointers
    .filter(([, pointer]) => pointer !== undefined && !isPointerIntoAnswer(pointer))
    .map(([place]) => issueAt(lines, place, pointerWords));
}

function waitIssues(lines: SourceLines, written: string | undefined): readonly DocumentIssue[] {
  if (written === undefined) {
    return [];
  }
  const reading = readDuration(written);
  const inBounds =
    'milliseconds' in reading &&
    reading.milliseconds >= replyWaitBounds.leastMs &&
    reading.milliseconds <= replyWaitBounds.mostMs;
  return inBounds ? [] : [issueAt(lines, placeOf('replies', 'wait'), waitWords)];
}

function deliveryIssues({ deliver }: WrittenRoute, place: TemplatePlace): readonly DocumentIssue[] {
  const { lines } = place;
  return [
    ...nameIssues(lines, [[placeOf('deliver', 'server'), deliver.server]], isServerName, serverNameShape),
    ...nameIssues(lines, [[placeOf('deliver', 'tool'), deliver.tool]], isToolName, toolNameShape),
    ...templatesIssues(deliveryTemplates, deliver.with, { ...place, pointer: placeOf('deliver', 'with') }),
    ...pointerIssues(lines, [
      [placeOf('deliver', 'sent', 'conversation'), deliver.sent?.conversation],
      [placeOf('deliver', 'sent', 'id'), deliver.sent?.id],
    ]),
  ];
}

function readingIssues(replies: Replies, place: TemplatePlace): readonly DocumentIssue[] {
  const { lines } = place;
  const { read, tell } = replies;
  return [
    ...nameIssues(
      lines,
      [
        [placeOf('replies', 'tool'), replies.tool],
        [placeOf('replies', 'tell', 'tool'), tell?.tool],
      ],
      isToolName,
      toolNameShape,
    ),
    ...templateIssues(conversationTemplates, replies.conversation ?? '', {
      ...place,
      pointer: placeOf('replies', 'conversation'),
    }),
    ...templatesIssues(readingTemplates, replies.with, { ...place, pointer: placeOf('replies', 'with') }),
    ...templatesIssues(tellingTemplates, tell?.with ?? {}, { ...place, pointer: placeOf('replies', 'tell', 'with') }),
    ...pointerIssues(lines, [
      [placeOf('replies', 'read', 'list'), read.list],
      [placeOf('replies', 'read', 'each', 'id'), read.each.id],
      [placeOf('replies', 'read', 'each', 'sender'), read.each.sender],
      [placeOf('replies', 'read', 'each', 'text'), read.each.text],
      [placeOf('replies', 'read', 'each', 'to'), read.each.to],
    ]),
    ...waitIssues(lines, replies.wait),
  ];
}

export function compiledRoute(
  written: WrittenRoute,
  lines: SourceLines,
  inputSchema: Schema.JsonObject | undefined,
): Result.Result<WrittenRoute, readonly DocumentIssue[]> {
  const place = { lines, pointer: '', inputSchema };
  const issues = [
    ...deliveryIssues(written, place),
    ...(written.replies === undefined ? [] : readingIssues(written.replies, place)),
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(written);
}
