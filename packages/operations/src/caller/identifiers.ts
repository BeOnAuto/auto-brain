import { Schema } from 'effect';

const orgIdPattern = /^[A-Za-z0-9_-]{1,64}$/u;

const brainIdPattern = /^[a-z][a-z0-9-]{2,47}$/u;

export const OrgIdSchema = Schema.String.check(Schema.isPattern(orgIdPattern));

export const BrainIdSchema = Schema.String.check(Schema.isPattern(brainIdPattern));

export function isOrgId(id: string): boolean {
  return orgIdPattern.test(id);
}

export function isBrainId(id: string): boolean {
  return brainIdPattern.test(id);
}
