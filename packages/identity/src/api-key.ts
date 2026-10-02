import { hash, randomBytes } from 'node:crypto';

import { CallerIdentitySchema } from '@beonauto/operations';
import { Schema } from 'effect';

import { localOrg } from './local-org.ts';

const KeyIdSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,32}$/u));

const DigestSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));

const KeyOrgSchema = CallerIdentitySchema.fields.org.check(
  Schema.makeFilter((org: string) => org !== localOrg || 'This org id is reserved for local mode'),
);

export const KeyGrantSchema = Schema.Struct({ ...CallerIdentitySchema.fields, id: KeyIdSchema, org: KeyOrgSchema });

export type KeyGrant = typeof KeyGrantSchema.Type;

export const ApiKeySchema = Schema.Struct({ ...KeyGrantSchema.fields, sha256: DigestSchema });

export type ApiKey = typeof ApiKeySchema.Type;

export interface CreatedKey {
  readonly key: string;
  readonly entry: ApiKey;
}

const presentedKey = /^abk_([a-z0-9-]{1,32})_[A-Za-z0-9_-]{43}$/u;

export function digestOf(key: string): string {
  return hash('sha256', key);
}

export function keyIdOf(key: string): string | undefined {
  return presentedKey.exec(key)?.[1];
}

export function createApiKey({ id, org, permissions, brains }: KeyGrant): CreatedKey {
  const key = `abk_${id}_${randomBytes(32).toString('base64url')}`;
  return { key, entry: { id, sha256: digestOf(key), org, permissions, brains } };
}
