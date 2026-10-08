const answerSchema = [
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
  '      note: { type: string, maxLength: 2000 }',
];

const inputSchema = [
  'input:',
  '  schema:',
  '    type: object',
  '    required: [campaign, owner]',
  '    properties:',
  '      campaign: { type: string }',
  '      owner: { type: string }',
];

export const chatDelivery: readonly string[] = [
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  "    channel: '#approvals-{{ to }}'",
  "    text: '{{ message }}'",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
];

export function approvalDocument(delivery: readonly string[] = [], expires = 'P2D'): string {
  return [
    '---',
    'description: Ask the campaign owner to approve a brief',
    "to: '{{ input.owner }}'",
    `expires: ${expires}`,
    ...delivery,
    ...inputSchema,
    ...answerSchema,
    '---',
    'Please review the brief for {{ input.campaign }}.',
  ].join('\n');
}

export function notificationDocument(delivery: readonly string[] = [], expires = 'PT1H'): string {
  return [
    '---',
    "to: '{{ input.owner }}'",
    `expires: ${expires}`,
    ...delivery,
    ...inputSchema,
    '---',
    'The brief for {{ input.campaign }} is out.',
  ].join('\n');
}
