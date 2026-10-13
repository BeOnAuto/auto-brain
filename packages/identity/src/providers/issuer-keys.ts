import { Result } from 'effect';
import { createRemoteJWKSet, customFetch, type RemoteJWKSet } from 'jose';

import { metadataOf } from './issuer-metadata.ts';
import { boundedFetchOf, issuerAnswerMs, UnreadAnswer, type IssuerRequests } from './issuer-requests.ts';

const mostKeySetBytes = 65_536;

const leastRefetchMs = 60_000;

async function keySetAt(jwksUri: string, requests: IssuerRequests): Promise<Result.Result<RemoteJWKSet, string>> {
  const keySet = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: issuerAnswerMs,
    cooldownDuration: leastRefetchMs,
    cacheMaxAge: Infinity,
    [customFetch]: boundedFetchOf(requests, mostKeySetBytes),
  });
  try {
    await keySet.reload();
  } catch (error) {
    return Result.fail(
      `its key set at ${jwksUri} ${error instanceof UnreadAnswer ? error.message : 'answers no key set'}`,
    );
  }
  return keySet.jwks()?.keys.length === 0
    ? Result.fail(`its key set at ${jwksUri} holds no keys`)
    : Result.succeed(keySet);
}

export async function keysOfIssuer(
  issuer: string,
  requests: IssuerRequests,
): Promise<Result.Result<RemoteJWKSet, string>> {
  const metadata = await metadataOf(issuer, requests);
  return Result.isFailure(metadata) ? Result.fail(metadata.failure) : keySetAt(metadata.success.jwksUri, requests);
}
