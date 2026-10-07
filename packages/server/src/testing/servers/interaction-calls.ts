import type { McpSession, ToolResult } from '@beonauto/api/testing';

export const approvalRequest = [
  '---',
  'channel: inbox',
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
  const asking = { primitive: 'interaction', name: 'approval' };
  await session.callTool('create_spec', inBrain({ ...asking, source: approvalRequest }));
  const asked = await session.callTool('execute_spec', inBrain({ ...asking, input: { owner: 'ada' } }));
  const executionId = String(asked.structuredContent?.['execution_id']);
  return [
    ['list_interactions', await session.callTool('list_interactions', inBrain({}))],
    [
      'answer_interaction',
      await session.callTool('answer_interaction', inBrain({ execution_id: executionId, answer: { choice: 'yes' } })),
    ],
  ];
}
