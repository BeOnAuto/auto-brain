import { Buffer } from 'node:buffer';

import { Effect } from 'effect';

import type { ChannelSettings } from '../channels/channel-settings.ts';
import { readChannelSettings } from '../channels/channels-reading.ts';

export const partnerSecret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;

export interface WebhookChannelOptions {
  readonly answers?: boolean;
  readonly to?: string;
}

export function webhookChannels(
  url: string,
  { answers = false, to = '^[a-z]+$' }: WebhookChannelOptions = {},
): ChannelSettings {
  return Effect.runSync(
    readChannelSettings(
      {
        CHANNELS: JSON.stringify({
          partner: {
            type: 'webhook',
            url,
            headers: { Authorization: 'Bearer ${PARTNER_API_KEY}' },
            secret: '${PARTNER_WEBHOOK_SECRET}',
            to,
            answers,
            org: 'acme',
          },
        }),
        PARTNER_API_KEY: 'partner-api-key-7f3a9c',
        PARTNER_WEBHOOK_SECRET: partnerSecret,
      },
      { servers: [] },
    ),
  );
}
