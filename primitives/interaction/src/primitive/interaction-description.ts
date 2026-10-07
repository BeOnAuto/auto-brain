import { outboundBounds } from '@beonauto/outbound';

import { interactionBounds } from '../run/run-bounds.ts';

const interactionExample = [
  '---',
  'description: Ask the campaign owner to approve a brief',
  'channel: approvals',
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [campaign, owner, summary]',
  '    properties:',
  '      campaign: { type: string }',
  '      owner: { type: string }',
  '      summary: { type: string, maxLength: 4000 }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
  '      note: { type: string, maxLength: 2000 }',
  '---',
  'Please review the brief for {{ input.campaign }}.',
  '',
  '{{ input.summary }}',
  '',
  'Reply approve or reject, with a note if you reject.',
].join('\n');

const naming = [
  'An interaction function asks a person or a system and takes the answer later: it sends a request through a channel',
  'the operator configured, or leaves it in the brain’s inbox, and its run waits until the request is answered, expires or is cancelled.',
  'Use interaction function in conversation. The tools identify this function type with `primitive: interaction`.',
].join(' ');

const format =
  'An interaction function definition is YAML front matter between --- lines, then the message, a Liquid template, for example:';

const rules = [
  'Front matter: channel (required, the name of a channel the operator configured, or inbox); to (required, a Liquid template',
  'over input, today and now naming the party, which must match what the channel allows); expires (required, an ISO 8601',
  'duration from PT1M to P30D); description; input: schema; output: schema, the shape of the answer, which is the run’s output.',
  'A function without output.schema is a notification: it takes no answer, and its run succeeds when its delivery lands,',
  'at once for the inbox. Any other key, model, tools and language among them, is rejected.',
  `The rendered party takes at most ${interactionBounds.toBytes} bytes and the message ${interactionBounds.messageBytes};`,
  'a value that renders as something other than text, a party the channel does not allow and a request over its bounds',
  'reject the run with conflict, kind unworkable. A channel this server does not offer to the brain rejects it as unavailable,',
  `kind channel_not_offered, and a brain with ${interactionBounds.openRequests} open requests as unavailable, kind requests_full.`,
  `A request is delivered at most ${outboundBounds.attempts} times, the first at once and then after 1, 2, 4 and 8 minutes.`,
  'Answer with answer_interaction, and see what waits with list_interactions. A request nobody answered in time ends the run',
  'rejected as unanswered, kind expired; a notification no attempt delivered ends it unanswered, kind undelivered.',
  'Asking again is a new run under a new id.',
].join(' ');

export const interactionDescription = `${naming} ${format}\n\n${interactionExample}\n\n${rules}`;
