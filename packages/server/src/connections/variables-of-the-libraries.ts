import { configFileVariable, serverConfigVariables } from '@on.auto/config';
import { connectionsSetting } from '@on.auto/connections';
import { apiKeysVariable } from '@on.auto/identity';
import { proxySettingsVariables } from '@on.auto/outbound';
import { awsCredentialVariables } from '@on.auto/outbound/aws';

export const variablesOfTheLibraries: readonly string[] = [
  ...serverConfigVariables,
  configFileVariable,
  apiKeysVariable,
  ...proxySettingsVariables,
  ...awsCredentialVariables,
  connectionsSetting,
];
