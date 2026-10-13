import type { ProtectedResource } from '@on.auto/identity';
import { allPermissions, type Permission } from '@on.auto/operations';

import { problemOf } from '../problem/problem.ts';

export const metadataPath = '/.well-known/oauth-protected-resource';

export const callerOfAnotherOrg = problemOf('forbidden', 'The caller does not belong to this org');

type Parameter = readonly [string, string];

export type ChallengeHeaders = Readonly<Record<string, string>>;

function challengeOf(parameters: readonly Parameter[]): string {
  return ['Bearer', parameters.map(([name, value]) => `${name}="${value}"`).join(', ')]
    .filter((part) => part !== '')
    .join(' ');
}

function metadataAddressOf({ publicUrl }: ProtectedResource, resourcePath = ''): string {
  return `${publicUrl}${metadataPath}${resourcePath}`;
}

export function unauthenticatedChallenge(resource: ProtectedResource | undefined, refused: boolean): string {
  const error: readonly Parameter[] = refused ? [['error', 'invalid_token']] : [];
  return challengeOf(
    resource === undefined
      ? error
      : [...error, ['resource_metadata', metadataAddressOf(resource)], ['scope', allPermissions.join(' ')]],
  );
}

export function insufficientScope(
  resource: ProtectedResource | undefined,
  scopes: readonly Permission[],
  resourcePath = '',
): ChallengeHeaders {
  const error: Parameter = ['error', 'insufficient_scope'];
  return {
    'www-authenticate': challengeOf(
      resource === undefined
        ? [error]
        : [error, ['scope', scopes.join(' ')], ['resource_metadata', metadataAddressOf(resource, resourcePath)]],
    ),
  };
}
