import type { Environment } from '@beonauto/config';
import { describe, expect, it } from 'vitest';

import { readSettings } from './settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettings(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

function contentOf(environment: Environment) {
  return readSettings({ CONTENT_STORE_URL: 's3://brain-content/a/b', ...environment }).content;
}

describe('the content store settings', () => {
  it('keep content in the ledger when CONTENT_STORE_URL is not set, whatever the endpoint', () => {
    expect(readSettings({ AWS_ENDPOINT_URL: 'http://127.0.0.1:9000' }).content).toEqual({ store: 'ledger' });
  });

  it('keep content on object storage in the bucket and under the prefix of CONTENT_STORE_URL', () => {
    expect(readSettings({ CONTENT_STORE_URL: 's3://brain-content', AWS_REGION: 'eu-west-1' }).content).toEqual({
      store: 'object-storage',
      location: { bucket: 'brain-content', prefix: '' },
      endpoint: undefined,
      region: 'eu-west-1',
    });
  });

  it('take the endpoint of AWS_ENDPOINT_URL_S3 before that of AWS_ENDPOINT_URL', () => {
    expect([
      contentOf({ AWS_ENDPOINT_URL: 'http://127.0.0.1:9000' }),
      contentOf({ AWS_ENDPOINT_URL: 'http://127.0.0.1:9000', AWS_ENDPOINT_URL_S3: ' https://storage.example.com ' }),
    ]).toEqual([
      expect.objectContaining({
        location: { bucket: 'brain-content', prefix: 'a/b' },
        endpoint: 'http://127.0.0.1:9000',
      }),
      expect.objectContaining({ endpoint: 'https://storage.example.com' }),
    ]);
  });
});

describe('the content store settings that cannot be read', () => {
  it.each([
    'brain-content',
    'https://brain-content/prefix',
    's3://',
    's3://Brain-Content',
    's3://a',
    's3://access:secret@brain-content/prefix',
    's3://brain-content:9000/prefix',
    's3://brain-content/prefix?versioning=on',
    's3://brain-content/%E0%A4%A',
  ])('stop the server at start for CONTENT_STORE_URL=%s, naming the setting', (url) => {
    expect(String(errorFrom({ CONTENT_STORE_URL: url }))).toBe(
      'InvalidSettingsError: The content store settings are invalid. CONTENT_STORE_URL: Expected an S3 URL such as s3://bucket/prefix, whose bucket is 3 to 63 lowercase letters, digits, dots and hyphens',
    );
  });

  it.each([
    ['AWS_ENDPOINT_URL', 'storage.example.com'],
    ['AWS_ENDPOINT_URL_S3', 'ftp://storage.example.com'],
  ])('stop the server at start for an endpoint in %s that is not an http or https URL', (setting, value) => {
    expect(String(errorFrom({ CONTENT_STORE_URL: 's3://brain-content', [setting]: value }))).toBe(
      `InvalidSettingsError: The content store settings are invalid. ${setting}: Expected an http or https URL such as https://storage.example.com`,
    );
  });
});
