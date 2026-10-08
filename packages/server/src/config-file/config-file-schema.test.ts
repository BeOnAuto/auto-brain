import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { configFileSchemaPath, configFileSchemaText } from './config-file-schema.ts';

const example = new URL('../../../../auto-brain.example.yaml', import.meta.url);

describe('the JSON Schema of the configuration file', () => {
  it('is committed as the settings generate it; pnpm --filter @beonauto/server config-schema writes it again', () => {
    expect(JSON.parse(readFileSync(configFileSchemaPath, 'utf8'))).toEqual(JSON.parse(configFileSchemaText()));
  });

  it('is the schema auto-brain.example.yaml names for an editor', () => {
    expect(readFileSync(example, 'utf8').split('\n', 1)).toEqual([
      '# yaml-language-server: $schema=./auto-brain.schema.json',
    ]);
  });
});
