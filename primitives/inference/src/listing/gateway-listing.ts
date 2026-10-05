import { Effect, Option, Redacted, Schema } from 'effect';

import { revealed } from '../adapter/direct-providers.ts';
import type { Fetch } from '../adapter/sdk-model.ts';
import type { GatewaySettings } from '../settings/gateway-settings.ts';
import { listedModel, type ListedModel } from './listed-model.ts';
import { decodedAs, endpointUrl, listingJson, type ProviderListing } from './listing-request.ts';

const gatewayList = decodedAs(Schema.Struct({ data: Schema.Array(Schema.Unknown) }));

const entryOf = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String,
    created: Schema.optionalKey(Schema.Unknown),
    name: Schema.optionalKey(Schema.Unknown),
    context_window: Schema.optionalKey(Schema.Unknown),
    max_tokens: Schema.optionalKey(Schema.Unknown),
    type: Schema.optionalKey(Schema.Unknown),
  }),
);

type GatewayEntry = Option.Option.Value<ReturnType<typeof entryOf>>;

function listUrl({ base_url: baseUrl, query_params: queryParams }: GatewaySettings): string {
  const url = endpointUrl(baseUrl, '/models');
  if (queryParams.size > 0) {
    url.search = new URLSearchParams(revealed(queryParams)).toString();
  }
  return url.toString();
}

function headersOf({ api_key: apiKey, headers }: GatewaySettings): Readonly<Record<string, string>> {
  return {
    ...(apiKey === null ? {} : { Authorization: `Bearer ${Redacted.value(apiKey)}` }),
    ...revealed(headers),
  };
}

function isLanguageModel({ id, type }: GatewayEntry): boolean {
  return id.trim() !== '' && (typeof type !== 'string' || type === 'language');
}

function modelsOf(gateway: string, entries: readonly unknown[]): readonly ListedModel[] {
  return entries
    .flatMap((entry) => Option.toArray(entryOf(entry)))
    .filter((entry) => isLanguageModel(entry))
    .map(({ id, ...details }) => listedModel(`${gateway}/${id}`, details));
}

export function gatewayListing(settings: GatewaySettings, fetch: Fetch): ProviderListing {
  const { name } = settings;
  return {
    read: listingJson({ fetch, url: listUrl(settings), headers: headersOf(settings) }).pipe(
      Effect.flatMap(gatewayList),
      Effect.map(({ data }) => modelsOf(name, data)),
    ),
  };
}
