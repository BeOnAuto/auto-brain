import { streamPrefixOfOrg } from '@beonauto/operations';

export const playbooksStream = 'playbooks';

export function playbooksStreamOfOrg(org: string): string {
  return `${streamPrefixOfOrg({ org })}${playbooksStream}`;
}
