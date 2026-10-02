import { fileSetting, type FileSetting } from '@beonauto/config';
import { ApiKeysSchema } from '@beonauto/identity';
import { ModelAliasesSchema, ModelGatewaysSchema } from '@beonauto/inference';
import { Schema } from 'effect';

import { Origin } from './origin.ts';

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

export const fileSettings: readonly FileSetting[] = [
  fileSetting(
    'ALLOWED_ORIGINS',
    Schema.Array(Origin).annotate({
      description:
        'The origins a page in a browser may call the API from, such as https://app.example.com. ALLOWED_ORIGINS wins over it',
    }),
    (origins) => origins.join(','),
  ),
  fileSetting(
    'API_KEYS',
    ApiKeysSchema.annotate({
      description: 'The API keys the server accepts, each as the key command prints it. API_KEYS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'MODEL_GATEWAYS',
    ModelGatewaysSchema.annotate({
      description: 'OpenAI-compatible gateways, each a provider prefix of its own. MODEL_GATEWAYS wins over it',
    }),
    asJson,
  ),
  fileSetting(
    'MODEL_ALIASES',
    ModelAliasesSchema.annotate({
      description:
        'Model references a spec may give, each sent on as another reference; a trailing * on both sides covers every model of a provider. MODEL_ALIASES wins over it',
    }),
    asJson,
  ),
];
