import { streamPrefixOfOrg } from '@beonauto/operations';

export const playbooksStream = 'brains';

export function playbooksStreamOfOrg(org: string): string {
  return `${streamPrefixOfOrg({ org })}${playbooksStream}`;
}
