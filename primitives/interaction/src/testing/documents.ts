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

export function approvalDocument(channel = 'inbox', expires = 'P2D'): string {
  return [
    '---',
    'description: Ask the campaign owner to approve a brief',
    `channel: ${channel}`,
    "to: '{{ input.owner }}'",
    `expires: ${expires}`,
    ...inputSchema,
    ...answerSchema,
    '---',
    'Please review the brief for {{ input.campaign }}.',
  ].join('\n');
}

export function notificationDocument(channel = 'inbox', expires = 'PT1H'): string {
  return [
    '---',
    `channel: ${channel}`,
    "to: '{{ input.owner }}'",
    `expires: ${expires}`,
    ...inputSchema,
    '---',
    'The brief for {{ input.campaign }} is out.',
  ].join('\n');
}
