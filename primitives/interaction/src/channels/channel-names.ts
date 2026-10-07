export const inboxChannel = 'inbox';

const channelName = /^[a-z][a-z0-9-]{0,31}$/u;

export function isChannelName(name: string): boolean {
  return channelName.test(name);
}
