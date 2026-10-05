import { Effect, Redacted, Schema } from 'effect';

import type { Fetch } from '../adapter/sdk-model.ts';
import type { GoogleSettings } from '../settings/provider-settings.ts';
import { listedModel } from './listed-model.ts';
import {
  decodedAs,
  endpointUrl,
  everyPage,
  listingJson,
  type ListingPage,
  type ProviderListing,
} from './listing-request.ts';

const GooglePageSchema = Schema.Struct({
  models: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        displayName: Schema.optionalKey(Schema.String),
        inputTokenLimit: Schema.optionalKey(Schema.Number),
        outputTokenLimit: Schema.optionalKey(Schema.Number),
        supportedGenerationMethods: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
    ),
  ),
  nextPageToken: Schema.optionalKey(Schema.String),
});

type GooglePage = typeof GooglePageSchema.Type;

const googlePage = decodedAs(GooglePageSchema);

const geminiApiUrl = 'https://generativelanguage.googleapis.com/v1beta';

const mostPerPage = 1000;

const resourcePrefix = 'models/';

function pageUrl(cursor: string | undefined): string {
  const url = endpointUrl(geminiApiUrl, '/models');
  url.searchParams.set('pageSize', String(mostPerPage));
  if (cursor !== undefined) {
    url.searchParams.set('pageToken', cursor);
  }
  return url.toString();
}

function modelIdOf(name: string): string {
  return name.startsWith(resourcePrefix) ? name.slice(resourcePrefix.length) : name;
}

function pageOf({ models = [], nextPageToken }: GooglePage): ListingPage {
  return {
    models: models
      .filter(({ supportedGenerationMethods = [] }) => supportedGenerationMethods.includes('generateContent'))
      .map(({ name, displayName, inputTokenLimit, outputTokenLimit }) =>
        listedModel(`google/${modelIdOf(name)}`, {
          name: displayName,
          context_window: inputTokenLimit,
          max_tokens: outputTokenLimit,
        }),
      ),
    next: nextPageToken === '' ? undefined : nextPageToken,
  };
}

export function googleListing(settings: GoogleSettings, fetch: Fetch): ProviderListing {
  const apiKey = Redacted.value(settings.api_key);
  const headers = { 'x-goog-api-key': apiKey };
  return {
    read: everyPage((cursor) =>
      listingJson({ fetch, url: pageUrl(cursor), headers }).pipe(Effect.flatMap(googlePage), Effect.map(pageOf)),
    ),
  };
}
