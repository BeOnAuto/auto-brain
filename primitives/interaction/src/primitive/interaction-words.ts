import { Buffer } from 'node:buffer';

import { asSentence } from '@beonauto/operations';
import { defaultRunWords, inWords, type RunAccount, type RunWords } from '@beonauto/specs';
import type { Schema } from 'effect';

import { inboxChannel } from '../channels/channel-names.ts';
import { requestRecordOf, takesAnswer } from '../run/request-record.ts';

const mostPartyBytes = 256;

function cutParty(party: string): string {
  const bytes = Buffer.from(party, 'utf8');
  return bytes.length <= mostPartyBytes ? party : new TextDecoder().decode(bytes.subarray(0, mostPartyBytes));
}

function throughWords(channel: string): string {
  return channel === inboxChannel ? 'in the brain’s inbox' : `through the channel “${channel}”`;
}

function requestAccount(record: Schema.JsonObject): RunAccount | undefined {
  const request = requestRecordOf(record);
  if (request === undefined) {
    return undefined;
  }
  const answers = takesAnswer(request);
  const what = answers ? 'A request is waiting for an answer' : 'A notification is waiting to be delivered';
  return {
    summary: `${what}, ${throughWords(request.channel)}, until ${request.expires_at}.`,
    data: {
      channel: request.channel,
      to: cutParty(request.to),
      message_bytes: Buffer.byteLength(request.message, 'utf8'),
      takes_answer: answers,
      expires_at: request.expires_at,
    },
  };
}

export const interactionRunWords: RunWords = {
  ...defaultRunWords,
  deferralType: 'interaction_requested',
  deferral: requestAccount,
};

export function describeAnswer(output: Schema.Json): string {
  if (output !== null && typeof output === 'object' && !Array.isArray(output) && Object.keys(output).length === 0) {
    return 'It delivered its notification.';
  }
  const words = inWords(output);
  return words === undefined
    ? 'Its answer is too long to repeat here; the whole of it is in the details below.'
    : asSentence(`Its answer: ${words}`);
}
