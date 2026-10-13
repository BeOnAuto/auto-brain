import { Option, Result, Schema } from 'effect';

import { JwkSchema, verifyingKeyOf, type SigningAlgorithm, type VerifyingKey } from '../tokens/signing-algorithms.ts';
import { metadataOf } from './issuer-metadata.ts';
import { jsonAt, type IssuerRequests } from './issuer-requests.ts';

const mostKeySetBytes = 65_536;

const leastRefetchMs = 60_000;

interface KeySet {
  readonly keyFor: (keyId: string) => Promise<VerifyingKey | undefined>;
}

const KeySetSchema = Schema.Struct({ keys: Schema.Array(Schema.Unknown) });

const IdentifiedJwkSchema = Schema.Struct({ ...JwkSchema.fields, kid: Schema.String });

const decodeKeySet = Schema.decodeUnknownOption(KeySetSchema);

const decodeJwk = Schema.decodeUnknownOption(IdentifiedJwkSchema);

type Keys = ReadonlyMap<string, VerifyingKey>;

function keyOf(json: unknown): readonly (readonly [string, VerifyingKey])[] {
  return Option.match(decodeJwk(json), {
    onNone: () => [],
    onSome: ({ kid, ...jwk }) => {
      const key = verifyingKeyOf(jwk);
      return key === undefined ? [] : [[kid, key]];
    },
  });
}

function keysIn(json: unknown): Result.Result<Keys, string> {
  const listed = decodeKeySet(json);
  if (Option.isNone(listed)) {
    return Result.fail('answers no key set');
  }
  const keys = new Map(listed.value.keys.flatMap(keyOf));
  return keys.size === 0 ? Result.fail('holds no key the runtime verifies with') : Result.succeed(keys);
}

async function keysAt(jwksUri: string, requests: IssuerRequests): Promise<Result.Result<Keys, string>> {
  const read = Result.flatMap(await jsonAt(requests, jwksUri, mostKeySetBytes), keysIn);
  return Result.mapError(read, (reason) => `its key set at ${jwksUri} ${reason}`);
}

async function keySetOf(jwksUri: string, requests: IssuerRequests): Promise<Result.Result<KeySet, string>> {
  const first = await keysAt(jwksUri, requests);
  if (Result.isFailure(first)) {
    return Result.fail(first.failure);
  }
  let keys = first.success;
  let fetchedAt = requests.now();
  let refetching: Promise<void> | undefined;
  const refetch = async (): Promise<void> => {
    fetchedAt = requests.now();
    keys = Result.getOrElse(await keysAt(jwksUri, requests), () => keys);
  };
  return Result.succeed({
    keyFor: async (keyId) => {
      if (keys.has(keyId) || (refetching === undefined && requests.now() - fetchedAt < leastRefetchMs)) {
        return keys.get(keyId);
      }
      refetching ??= refetch().finally(() => {
        refetching = undefined;
      });
      await refetching;
      return keys.get(keyId);
    },
  });
}

export interface IssuerKeys {
  readonly algorithms: readonly SigningAlgorithm[];
  readonly keys: KeySet;
}

export async function keysOfIssuer(
  issuer: string,
  requests: IssuerRequests,
): Promise<Result.Result<IssuerKeys, string>> {
  const metadata = await metadataOf(issuer, requests);
  if (Result.isFailure(metadata)) {
    return Result.fail(metadata.failure);
  }
  const keys = await keySetOf(metadata.success.jwksUri, requests);
  return Result.map(keys, (keySet) => ({ algorithms: metadata.success.algorithms, keys: keySet }));
}
