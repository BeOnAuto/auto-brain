import { listed } from '@on.auto/operations';
import { isPinnableUrl } from '@on.auto/tool-servers';
import { Schema } from 'effect';

const credentialKinds = ['none', 'reference', 'secret', 'client_credentials', 'authorization'] as const;

export const CredentialKindSchema = Schema.Literals(credentialKinds);

export type CredentialKind = typeof CredentialKindSchema.Type;

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const CredentialFieldsSchema = Schema.Struct({
  kind: CredentialKindSchema,
  name: Schema.optionalKey(
    NamedSchema.annotate({
      description:
        'For reference, the variable of the runtime that holds the value, such as CRM_API_KEY; for secret, the header, query parameter or security scheme the value is sent as',
    }),
  ),
  in: Schema.optionalKey(
    Schema.Literals(['header', 'query', 'security']).annotate({
      description:
        'For secret, what name is: header, or for an HTTP API query, a query parameter, or security, a security scheme of its document',
    }),
  ),
  issuer: Schema.optionalKey(
    Schema.String.annotate({ description: 'For client_credentials, the https URL of the authorization server' }),
  ),
  client_id: Schema.optionalKey(NamedSchema.annotate({ description: 'For client_credentials, the id of the client' })),
  scope: Schema.optionalKey(
    Schema.String.annotate({
      description: 'For client_credentials, the scopes, separated by spaces; none when left out',
    }),
  ),
});

type CredentialFields = typeof CredentialFieldsSchema.Type;

type Field = Exclude<keyof CredentialFields, 'kind'>;

const everyField: readonly Field[] = ['name', 'in', 'issuer', 'client_id', 'scope'];

interface TakenFields {
  readonly required: readonly Field[];
  readonly optional: readonly Field[];
}

const fieldsOfEachKind: Readonly<Record<CredentialKind, TakenFields>> = {
  none: { required: [], optional: [] },
  reference: { required: ['name'], optional: [] },
  secret: { required: ['name', 'in'], optional: [] },
  client_credentials: { required: ['issuer', 'client_id'], optional: ['scope'] },
  authorization: { required: [], optional: [] },
};

const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

interface FieldIssue {
  readonly path: readonly [Field];
  readonly issue: string;
}

function fieldsTakenInWords({ required, optional }: TakenFields): string {
  const taken = [...required, ...optional];
  return taken.length === 0 ? 'no other field' : listed(taken);
}

function presenceIssuesOf(credential: CredentialFields): readonly FieldIssue[] {
  const taken = fieldsOfEachKind[credential.kind];
  const { required, optional } = taken;
  return everyField.flatMap((field): readonly FieldIssue[] => {
    const given = credential[field] !== undefined;
    if (!given && required.includes(field)) {
      return [{ path: [field], issue: `Expected ${field}, which a ${credential.kind} credential takes` }];
    }
    return given && !required.includes(field) && !optional.includes(field)
      ? [
          {
            path: [field],
            issue: `Expected no ${field}: a ${credential.kind} credential takes ${fieldsTakenInWords(taken)}`,
          },
        ]
      : [];
  });
}

function nameIssuesOf({ kind, name, in: placement }: CredentialFields): readonly FieldIssue[] {
  if (name === undefined) {
    return [];
  }
  if (kind === 'reference') {
    return variableName.test(name)
      ? []
      : [{ path: ['name'], issue: 'Expected the name of a variable, such as CRM_API_KEY' }];
  }
  return kind === 'secret' && placement === 'header' && !headerName.test(name)
    ? [{ path: ['name'], issue: 'Expected a header name' }]
    : [];
}

function issuerIssuesOf({ kind, issuer }: CredentialFields): readonly FieldIssue[] {
  return kind !== 'client_credentials' || issuer === undefined || isPinnableUrl(issuer)
    ? []
    : [{ path: ['issuer'], issue: 'Expected an https URL, or an http URL on a loopback address' }];
}

export const CredentialSchema = CredentialFieldsSchema.annotate({
  description: 'How the server is credentialled, never its value, which the person gives on the page',
}).check(
  Schema.makeFilter((credential: CredentialFields) => [
    ...presenceIssuesOf(credential),
    ...nameIssuesOf(credential),
    ...issuerIssuesOf(credential),
  ]),
);

export type Credential = typeof CredentialSchema.Type;

export const HeldCredentialSchema = Schema.Struct({
  ...CredentialFieldsSchema.fields,
  ends_with: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The last four characters of the secret or client secret the person gave, where it holds twelve or more',
    }),
  ),
}).annotate({ description: 'How the server is credentialled, never its value, which the person gives on the page' });

export type HeldCredential = typeof HeldCredentialSchema.Type;
