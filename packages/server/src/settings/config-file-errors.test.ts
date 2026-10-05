import { describe, expect, it } from 'vitest';

import { configuredServer } from '../testing/configured-server.ts';
import { spawnedServerTestTimeoutMs } from '../testing/spawned-server.ts';

const secret = 'sk-live-SECRET-0123456789abcdef';

async function startupLine(configText: string, environment: Readonly<Record<string, string>> = {}): Promise<string> {
  const { child, configFile } = configuredServer(configText, { LOCAL_MODE: 'true', ...environment });
  const exitCode = await child.exited;
  const { stderr } = child.output();
  expect({ exitCode, secret: stderr.includes(secret) }).toEqual({ exitCode: 1, secret: false });
  return stderr.replaceAll(configFile, 'auto-brain.yaml');
}

const invalid = 'auto-brain could not start: ConfigFileInvalid: The configuration file auto-brain.yaml is invalid:';

describe('a configuration file the server cannot use', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('stops the start when the file is missing, naming it', async () => {
    const { child, configFile } = configuredServer(undefined, { CONFIG_FILE: '/nonexistent/auto-brain.yaml' });

    expect({ exitCode: await child.exited, stderr: child.output().stderr, configFile }).toMatchObject({
      exitCode: 1,
      stderr:
        'auto-brain could not start: ConfigFileInvalid: The configuration file /nonexistent/auto-brain.yaml, which CONFIG_FILE names, does not exist\n',
    });
  });
});

describe('a configuration file the server cannot read as settings', { timeout: spawnedServerTestTimeoutMs }, () => {
  it.each([
    [
      'is not YAML',
      'model_aliases: [unclosed\n',
      `${invalid} auto-brain.yaml:2:1: Flow sequence in block collection must be sufficiently indented and end with a ]\n`,
    ],
    [
      'holds a value its setting does not accept',
      'model_gateways:\n  - name: gateway\n    base_url: 8080\n    colour: blue\n',
      `${invalid} auto-brain.yaml:3:15 model_gateways[0].base_url: Expected string; auto-brain.yaml:4:13 model_gateways[0].colour: Expected no excess property\n`,
    ],
    [
      'refers to a variable that is not set',
      'model_gateways:\n  - name: gateway\n    base_url: https://gateway.example.com/v1\n    api_key: ${GATEWAY_API_KEY}\n',
      `${invalid} auto-brain.yaml:4:14 model_gateways[0].api_key: Refers to the environment variable GATEWAY_API_KEY, which is not set\n`,
    ],
    [
      'holds a credential instead of a reference to one',
      `model_gateways:\n  - name: gateway\n    base_url: https://gateway.example.com/v1\n    api_key: ${secret}\n`,
      `${invalid} auto-brain.yaml:4:14 model_gateways[0].api_key: Looks like a credential, which this file never holds; write a reference to the environment variable that holds it instead, such as \${GATEWAY_API_KEY}\n`,
    ],
    [
      'holds the URL of the ledger database, which only the environment holds',
      `database_url: postgresql://brains:${secret}@db.example.com/brains\n`,
      `${invalid} auto-brain.yaml:1:15 database_url: Not a setting this file holds; it holds allowed_origins, api_keys, model_gateways, model_aliases\n`,
    ],
  ])('stops the start when it %s, naming the line and the key and never a value', async (_, text, line) => {
    await expect(startupLine(text)).resolves.toBe(line);
  });

  it('stops the start at the line of a setting the model settings refuse', async () => {
    const text = `model_gateways:
  - name: gateway
    base_url: https://a.example.com/v1
  - name: gateway
    base_url: ftp://b.example.com
`;

    await expect(startupLine(text, { MODEL_ALIASES: '{"fast":"gemini"}' })).resolves.toBe(
      'auto-brain could not start: model_settings_invalid: The model settings are invalid. ' +
        'auto-brain.yaml:4:11 model_gateways[1].name: gateway is used twice; ' +
        'auto-brain.yaml:5:15 model_gateways[1].base_url: Expected an http or https URL; ' +
        'MODEL_ALIASES: /fast: An alias and its target are each written provider/model\n',
    );
  });
});
