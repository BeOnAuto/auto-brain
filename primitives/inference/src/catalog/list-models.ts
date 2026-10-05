import { defineQuery } from '@beonauto/operations';
import { Schema } from 'effect';

import type { ModelCatalog } from './catalog-listing.ts';
import { modelsListed } from './catalog-words.ts';
import { ModelListSchema } from './model-list.ts';

const task = 'list the models this server can call';

const description = [
  'Lists the models this server can call, in the shape of the list of models of the OpenAI API, so a spec can name one that works.',
  'Each entry has the id a spec gives as its model (provider/model id), object model, created (seconds since 1970, 0 when the provider does not say),',
  'owned_by (the provider prefix that serves it) and, when the provider reports them, name, context_window and max_tokens.',
  'An alias its operator set is listed by its own name, with resolved_to naming the model it is sent to;',
  'an entry whose id ends in * has pattern true and stands for any model id in place of the *.',
  'Lists are read from the providers with the credentials of this server and kept for five minutes;',
  'catalog_status is partial when a provider could not be asked, so its models are missing or as they were last read,',
  'and listed_at says when the oldest list was read.',
].join(' ');

const InputSchema = Schema.Struct({
  provider: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u)).annotate({
      description: 'Lists only the models this provider prefix serves, such as anthropic or the name of a gateway',
    }),
  ),
});

export function defineListModels(catalog: ModelCatalog) {
  return defineQuery('org', {
    name: 'list_models',
    title: 'List models',
    description,
    route: { method: 'GET', path: '/models' },
    inputSchema: InputSchema,
    outputSchema: ModelListSchema,
    reasons: [],
    handle: ({ provider }) => catalog.list(provider),
    plainLanguage: {
      task,
      attempt: ({ provider }) => (provider === undefined ? task : `${task} through ${provider}`),
      outcome: (list, { provider }) => modelsListed(list, provider),
    },
  });
}
