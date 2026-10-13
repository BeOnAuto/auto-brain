import { Option, Result, Schema } from 'effect';

import { signingAlgorithms, type SigningAlgorithm } from '../tokens/signing-algorithms.ts';
import { jsonAt, type IssuerRequests } from './issuer-requests.ts';

export interface IssuerMetadata {
  readonly jwksUri: string;
  readonly algorithms: readonly SigningAlgorithm[];
}

const mostMetadataBytes = 65_536;

const MetadataSchema = Schema.Struct({
  issuer: Schema.String,
  jwks_uri: Schema.String,
  id_token_signing_alg_values_supported: Schema.optionalKey(Schema.Array(Schema.String)),
});

const decodeMetadata = Schema.decodeUnknownOption(MetadataSchema);

export function metadataAddressesOf(issuer: string): readonly string[] {
  const { origin, pathname } = new URL(issuer);
  const path = pathname.replace(/\/$/u, '');
  return path === ''
    ? [`${origin}/.well-known/oauth-authorization-server`, `${origin}/.well-known/openid-configuration`]
    : [
        `${origin}/.well-known/oauth-authorization-server${path}`,
        `${origin}/.well-known/openid-configuration${path}`,
        `${origin}${path}/.well-known/openid-configuration`,
      ];
}

function metadataIn(json: unknown, issuer: string): Result.Result<IssuerMetadata, string> {
  const decoded = decodeMetadata(json);
  if (Option.isNone(decoded)) {
    return Result.fail('answers no metadata with an issuer and a jwks_uri');
  }
  const { issuer: named, jwks_uri: jwksUri, id_token_signing_alg_values_supported: listed } = decoded.value;
  if (named !== issuer) {
    return Result.fail(`names the issuer ${named}`);
  }
  if (URL.parse(jwksUri)?.protocol !== 'https:') {
    return Result.fail('names a jwks_uri that is not an https URL');
  }
  const algorithms = signingAlgorithms.filter((algorithm) => listed?.includes(algorithm) ?? true);
  return algorithms.length === 0
    ? Result.fail(`signs with none of ${signingAlgorithms.join(', ')}`)
    : Result.succeed({ jwksUri, algorithms });
}

async function firstMetadataAt(
  addresses: readonly string[],
  issuer: string,
  requests: IssuerRequests,
  refusals: readonly string[],
): Promise<Result.Result<IssuerMetadata, string>> {
  const [address, ...rest] = addresses;
  if (address === undefined) {
    return Result.fail(`no metadata of ${issuer} could be used: ${refusals.join('; ')}`);
  }
  const read = Result.flatMap(await jsonAt(requests, address, mostMetadataBytes), (json) => metadataIn(json, issuer));
  return Result.isSuccess(read)
    ? read
    : firstMetadataAt(rest, issuer, requests, [...refusals, `${address} ${read.failure}`]);
}

export function metadataOf(issuer: string, requests: IssuerRequests): Promise<Result.Result<IssuerMetadata, string>> {
  return firstMetadataAt(metadataAddressesOf(issuer), issuer, requests, []);
}
