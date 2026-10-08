import { defineQuery } from '@beonauto/operations';
import { Schema } from 'effect';

import type { ModelCatalog } from './catalog-listing.ts';
import { modelsListed } from './catalog-words.ts';
import { ModelListSchema } from './model-list.ts';

const task = 'list the models this server can call';

const description = [
  'Lists the models this server can call, so a reasoning function names one that runs.',
  'Each id is what a reasoning function gives as its model, written provider/model;',
  'an id that ends in * stands for any model of that provider and is not itself a model to run,',
  'and an alias its operator named says in resolved_to the model it is sent to.',
  'Use it before a reasoning function names its model, or when a run says its model is not offered.',
  '`provider` keeps the models of one provider or gateway, and catalog_status is partial when a provider could not be asked.',
].join(' ');

const InputSchema = Schema.Struct({
  provider: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Lists only the models this provider prefix serves, such as anthropic or the name of a gateway',
    }).check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u)),
  ),
});

export function defineListModels(catalog: ModelCatalog) {
  return defineQuery('org', {
    name: 'list_models',
    title: 'List models',
    description,
    route: { method: 'GET', path: '/models' },
    reachesOutside: true,
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
