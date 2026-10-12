import { describe, expect, it } from 'vitest';

import { storageClientOf } from './storage-client.ts';

const credentials = { accessKeyId: 'access', secretAccessKey: 'secret' };

const noProxy = { enabled: false, environment: {} };

describe('the client of an object store', () => {
  it('addresses a custom endpoint by path, in the region it is given', async () => {
    const client = storageClientOf(
      { endpoint: 'http://127.0.0.1:9000', region: 'eu-west-1', proxy: noProxy },
      credentials,
    );

    expect([
      client.config.forcePathStyle,
      await client.config.region(),
      (await client.config.endpoint?.())?.hostname,
    ]).toEqual([true, 'eu-west-1', '127.0.0.1']);
  });

  it('addresses the endpoint of its region by host without a custom endpoint, and checksums only what the API requires', async () => {
    const client = storageClientOf({ endpoint: undefined, region: 'eu-west-1', proxy: noProxy }, credentials);

    expect([
      client.config.forcePathStyle,
      client.config.endpoint,
      await client.config.requestChecksumCalculation(),
      await client.config.responseChecksumValidation(),
    ]).toEqual([false, undefined, 'WHEN_REQUIRED', 'WHEN_REQUIRED']);
  });

  it('leaves the region to the default chain of the AWS SDK when none is given', () => {
    const client = storageClientOf(
      {
        endpoint: undefined,
        region: undefined,
        proxy: { enabled: true, environment: { HTTPS_PROXY: 'http://proxy:3128' } },
      },
      credentials,
    );

    expect(typeof client.config.region).toBe('function');
  });
});
