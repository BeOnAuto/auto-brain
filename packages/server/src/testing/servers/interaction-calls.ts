import type { McpSession, ToolResult } from '@beonauto/api/testing';

const approvalRequest = [
  '---',
  "to: '{{ input.owner }}'",
  'expires: P1D',
  'output:',
  '  schema: { type: object, required: [choice], properties: { choice: { type: string } } }',
  '---',
  'Approve the quarter?',
].join('\n');

type InBrain = (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;

export async function interactionsCalled(
  session: McpSession,
  inBrain: InBrain,
): Promise<readonly (readonly [string, ToolResult])[]> {
  const asking = { type: 'interaction', name: 'approval' };
  await session.callTool('create_definition', inBrain({ ...asking, source: approvalRequest }));
  const asked = await session.callTool('run_definition', inBrain({ ...asking, input: { owner: 'ada' } }));
  const runId = String(asked.structuredContent?.['run_id']);
  return [
    ['list_interactions', await session.callTool('list_interactions', inBrain({}))],
    [
      'answer_interaction',
      await session.callTool('answer_interaction', inBrain({ run_id: runId, answer: { choice: 'yes' } })),
    ],
  ];
}
