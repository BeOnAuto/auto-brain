import { OrgIdSchema, PermissionSchema, PlaybookAccessSchema } from '@on.auto/operations';
import { Option, Result, Schema } from 'effect';

import { refusingTheLocalOrg } from '../access/local-org.ts';
import { readJsonSetting, type Environment } from '../settings/json-setting.ts';
import { InvalidIdentityProvidersError } from './invalid-identity-providers-error.ts';

const ProviderNameSchema = Schema.String.annotate({
  description:
    'The name of the provider, which a signed-in person is recorded under as person:<name>/<subject>: 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
}).check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u));

function isIssuer(text: string): boolean {
  const url = URL.parse(text);
  return (
    url?.protocol === 'https:' &&
    [text, `${text}/`].includes(url.href) &&
    url.username === '' &&
    url.password === '' &&
    !/[?#]/u.test(text)
  );
}

const IssuerSchema = Schema.String.annotate({
  description:
    "The issuer the tokens' iss must equal, an https URL with no query or fragment, as the provider writes it; its metadata is read from it at start",
}).check(
  Schema.makeFilter(
    (text: string) =>
      isIssuer(text) || 'Expected an https URL with no query or fragment, as the provider writes its issuer',
  ),
);

const ClaimNameSchema = Schema.String.check(Schema.isPattern(/^[!-~]{1,256}$/u));

const ClaimValueSchema = Schema.String.check(Schema.isPattern(/^\S{1,256}$/u));

const GrantSchema = Schema.Struct({
  permissions: Schema.Array(PermissionSchema),
  playbooks: PlaybookAccessSchema,
});

const MembershipSchema = Schema.Struct({
  claim: ClaimNameSchema.annotate({ description: 'The claim whose values must hold value' }),
  value: ClaimValueSchema.annotate({ description: 'The value the claim must hold for this entry to apply' }),
}).annotate({
  description: 'The claim value a token must hold for this entry to apply; every token of the issuer when left out',
});

const GrantsSchema = Schema.Struct({
  claim: ClaimNameSchema.annotate({
    description:
      'The claim whose values grant, an array of strings or a string of words separated by spaces, as scope is',
  }),
  by: Schema.Record(ClaimValueSchema, GrantSchema)
    .annotate({ description: 'The permissions and playbooks each value of the claim grants in the org' })
    .check(Schema.makeFilter((by: object) => Object.keys(by).length > 0 || 'Expected at least one value that grants')),
});

const IdentityProviderSchema = Schema.Struct({
  name: ProviderNameSchema,
  issuer: IssuerSchema,
  org: OrgIdSchema.annotate({ description: 'The org this entry admits a signed-in person to' }).check(
    refusingTheLocalOrg,
  ),
  membership: Schema.optionalKey(MembershipSchema),
  grants: GrantsSchema,
  subject: Schema.optionalKey(
    ClaimNameSchema.annotate({ description: 'The claim that names the person; sub when left out' }),
  ),
});

export type IdentityProvider = typeof IdentityProviderSchema.Type;

function oneEntryPerIssuerAndOrg(providers: readonly IdentityProvider[]): true | string {
  const pairs = new Set(providers.map(({ issuer, org }) => JSON.stringify([issuer, org])));
  return pairs.size === providers.length || 'An org has at most one entry for each issuer';
}

function oneNamePerIssuer(providers: readonly IdentityProvider[]): true | string {
  const names = new Set(providers.map(({ name }) => name));
  const issuers = new Set(providers.map(({ issuer }) => issuer));
  const pairs = new Set(providers.map(({ name, issuer }) => JSON.stringify([name, issuer])));
  return (names.size === pairs.size && issuers.size === pairs.size) || 'An issuer has one name, and a name one issuer';
}

export const IdentityProvidersSchema = Schema.Array(IdentityProviderSchema).check(
  Schema.makeFilter(oneEntryPerIssuerAndOrg),
  Schema.makeFilter(oneNamePerIssuer),
);

const decodeIdentityProviders = Schema.decodeUnknownResult(Schema.fromJsonString(IdentityProvidersSchema), {
  onExcessProperty: 'error',
  errors: 'all',
});

export function readIdentityProviders(environment: Environment): readonly IdentityProvider[] {
  const read = readJsonSetting(environment, 'IDENTITY_PROVIDERS', decodeIdentityProviders);
  if (Result.isFailure(read)) {
    throw new InvalidIdentityProvidersError({ message: read.failure });
  }
  return Option.getOrElse(read.success, () => []);
}
