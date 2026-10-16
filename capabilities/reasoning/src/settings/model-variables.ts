import { googleCredentialVariables } from '../adapter/credential-sources.ts';
import { entraIdVariables } from '../adapter/entra-id.ts';
import { modelListVariables } from './model-settings.ts';
import { providerVariables } from './provider-settings.ts';

export const modelVariables: readonly string[] = [
  ...Object.values(modelListVariables),
  ...providerVariables,
  ...googleCredentialVariables,
  ...entraIdVariables,
];
