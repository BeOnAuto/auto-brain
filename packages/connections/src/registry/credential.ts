import { Schema } from 'effect';

const credentialKinds = ['none', 'reference', 'secret', 'client_credentials', 'authorization'] as const;

export const CredentialKindSchema = Schema.Literals(credentialKinds);

export type CredentialKind = typeof CredentialKindSchema.Type;

const placedName = Schema.String.check(Schema.isMinLength(1));

const PlacedSchema = Schema.Union([
  Schema.Struct({ header: placedName.annotate({ description: 'A header' }) }),
  Schema.Struct({ query: placedName.annotate({ description: 'A query parameter of an HTTP API' }) }),
  Schema.Struct({ security: placedName.annotate({ description: 'A security scheme of its document' }) }),
]).annotate({ description: 'Where the value goes' });

export type Placed = typeof PlacedSchema.Type;

export const CredentialSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('none') }),
  Schema.Struct({
    kind: Schema.Literal('reference'),
    name: Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u)).annotate({
      description: 'The variable of the runtime that holds it, such as CRM_API_KEY',
    }),
  }),
  Schema.Struct({ kind: Schema.Literal('secret'), placed: PlacedSchema }),
  Schema.Struct({
    kind: Schema.Literal('client_credentials'),
    issuer: Schema.String.annotate({ description: 'The https URL of the authorization server' }),
    client_id: Schema.String.check(Schema.isMinLength(1)),
    scope: Schema.optionalKey(Schema.String.annotate({ description: 'The scopes, separated by spaces' })),
  }),
  Schema.Struct({ kind: Schema.Literal('authorization') }),
]).annotate({ description: 'How the server is credentialled, never its value, which the person gives on the page' });

export type Credential = typeof CredentialSchema.Type;
