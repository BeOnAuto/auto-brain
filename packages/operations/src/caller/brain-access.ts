import { Predicate, Schema } from 'effect';

import { BrainIdSchema } from './identifiers.ts';

export const BrainAccessSchema = Schema.Union([Schema.Literal('*'), Schema.Array(BrainIdSchema)]);

export type BrainAccess = typeof BrainAccessSchema.Type;

export function canAccessBrain(access: BrainAccess, brain: unknown): boolean {
  return access === '*' || (Array.isArray(access) && Predicate.isString(brain) && access.includes(brain));
}
