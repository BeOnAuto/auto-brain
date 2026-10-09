import { readFileSync } from 'node:fs';

import { plainTextIn, type McpSession, type ToolResult } from '@beonauto/api/testing';
import { Schema } from 'effect';

import { until } from './workflow-calls.ts';
import { runIdIn } from './workflow-server.ts';

export interface TutorialRun {
  readonly summaries: readonly string[];
  readonly output: unknown;
  readonly answeredAgain: boolean | undefined;
}

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ summary: Schema.String })) }),
);

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({ interactions: Schema.Array(Schema.Struct({ run_id: Schema.String })) }),
);

const review = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {brief: {type: string}}, required: [brief]}',
  '---',
  'Review this brief against the four criteria: {{ input.brief }}',
].join('\n');

const fencedBlock = /```(\w+)\n([\s\S]*?)```/gu;

export function pageOf(page: string): string {
  return readFileSync(new URL(`../../../../../docs/${page}`, import.meta.url), 'utf8');
}

export function fencedBlocksOf(page: string): ReadonlyMap<string, string> {
  const blocks = new Map<string, string>();
  for (const [, language = '', body = ''] of pageOf(page).matchAll(fencedBlock)) {
    blocks.set(language, blocks.get(language) ?? body);
  }
  return blocks;
}

const tutorial = fencedBlocksOf('tutorials/first-workflow.md');

function inTutorial(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { brain: 'campaign-review-tutorial', ...input };
}

function called(session: McpSession, tool: string, input: Readonly<Record<string, unknown>>): Promise<ToolResult> {
  return session.callTool(tool, inTutorial(input));
}

function settledOn(session: McpSession, id: string): Promise<ToolResult> {
  return until(
    () => called(session, 'get_run', { run_id: id }),
    ({ structuredContent }) => structuredContent?.['status'] !== 'started',
  );
}

async function saved(session: McpSession): Promise<readonly string[]> {
  await session.callTool('create_brain', { brain: 'campaign-review-tutorial', name: 'Campaign review tutorial' });
  await called(session, 'create_definition', { type: 'reasoning', name: 'review-campaign-brief', source: review });
  return [
    plainTextIn(
      await called(session, 'create_definition', {
        type: 'interaction',
        name: 'approve-campaign-brief',
        source: tutorial.get('markdown'),
      }),
    ),
    plainTextIn(
      await called(session, 'create_definition', {
        type: 'workflow',
        name: 'review-and-approve',
        source: tutorial.get('yaml'),
      }),
    ),
  ];
}

async function startedAndAsked(session: McpSession) {
  const started = await called(session, 'run_definition', {
    type: 'workflow',
    name: 'review-and-approve',
    input: { brief: tutorial.get('text'), owner: 'ada@example.com' },
  });
  const listed = await until(
    () => called(session, 'list_interactions', {}),
    ({ structuredContent }) => decodeListed(structuredContent).interactions.length > 0,
  );
  const [request] = decodeListed(listed.structuredContent).interactions;
  return {
    started,
    listed,
    workflowId: runIdIn(started.structuredContent),
    requestId: String(request?.run_id),
  };
}

export async function tutorialRunOn(session: McpSession): Promise<TutorialRun> {
  const created = await saved(session);
  const { started, listed, workflowId, requestId } = await startedAndAsked(session);
  const answer = { verdict: 'approve', note: 'Approved for the autumn launch.' };
  const answered = await called(session, 'answer_interaction', { run_id: requestId, answer });
  const ended = await settledOn(session, workflowId);
  const history = await called(session, 'get_run_history', { run_id: workflowId });
  const request = await settledOn(session, requestId);
  const inbox = await called(session, 'list_interactions', {});
  const again = await called(session, 'answer_interaction', { run_id: requestId, answer: { verdict: 'revise' } });
  return {
    summaries: [
      ...created,
      ...[started, listed, answered, history, request, ended, inbox].map((result) => plainTextIn(result)),
      ...decodeEvents(history.structuredContent).events.map(({ summary }) => summary),
    ],
    output: ended.structuredContent?.['output'],
    answeredAgain: again.isError,
  };
}
