import { Effect, Redacted, Schema } from 'effect';

import { defaultBaseUrls } from '../adapter/direct-providers.ts';
import type { Fetch } from '../adapter/sdk-model.ts';
import type { AnthropicSettings } from '../settings/provider-settings.ts';
import { listedModel } from './listed-model.ts';
import {
  decodedAs,
  endpointUrl,
  everyPage,
  listingJson,
  type ListingPage,
  type ProviderListing,
} from './listing-request.ts';

const AnthropicPageSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      display_name: Schema.optionalKey(Schema.String),
      created_at: Schema.optionalKey(Schema.String),
      max_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      max_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    }),
  ),
  has_more: Schema.optionalKey(Schema.Boolean),
  last_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

type AnthropicPage = typeof AnthropicPageSchema.Type;

const anthropicPage = decodedAs(AnthropicPageSchema);

const mostPerPage = 1000;

function headersOf({ credential }: AnthropicSettings): Readonly<Record<string, string>> {
  return {
    'anthropic-version': '2023-06-01',
    ...(credential.type === 'api_key'
      ? { 'x-api-key': Redacted.value(credential.key) }
      : { authorization: `Bearer ${Redacted.value(credential.token)}` }),
  };
}

function pageUrl(baseUrl: string, cursor: string | undefined): string {
  const url = endpointUrl(baseUrl, '/models');
  url.searchParams.set('limit', String(mostPerPage));
  if (cursor !== undefined) {
    url.searchParams.set('after_id', cursor);
  }
  return url.toString();
}

function nextOf({ has_more: hasMore, last_id: lastId }: AnthropicPage): string | undefined {
  return hasMore === true && typeof lastId === 'string' ? lastId : undefined;
}

function pageOf(page: AnthropicPage): ListingPage {
  return {
    models: page.data.map(({ id, display_name, created_at, max_input_tokens, max_tokens }) =>
      listedModel(`anthropic/${id}`, {
        name: display_name,
        created: created_at === undefined ? 0 : Date.parse(created_at) / 1000,
        context_window: max_input_tokens,
        max_tokens,
      }),
    ),
    next: nextOf(page),
  };
}

export function anthropicListing(settings: AnthropicSettings, fetch: Fetch): ProviderListing {
  const baseUrl = settings.base_url ?? defaultBaseUrls.anthropic;
  const headers = headersOf(settings);
  return {
    read: everyPage((cursor) =>
      listingJson({ fetch, url: pageUrl(baseUrl, cursor), headers }).pipe(
        Effect.flatMap(anthropicPage),
        Effect.map(pageOf),
      ),
    ),
  };
}
