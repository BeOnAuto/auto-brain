import { streamPrefixOfOrg } from '@beonauto/operations';

export const brainsStream = 'brains';

export function brainsStreamOfOrg(org: string): string {
  return `${streamPrefixOfOrg({ org })}${brainsStream}`;
}
