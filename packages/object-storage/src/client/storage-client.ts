import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { awsClientSettingsOf, type ProxySettings } from '@beonauto/outbound/aws';

export interface StorageEndpoint {
  readonly endpoint: string | undefined;
  readonly region: string | undefined;
  readonly proxy: ProxySettings;
}

export type StorageCredentials = NonNullable<S3ClientConfig['credentials']>;

export function storageClientOf(
  { endpoint, region, proxy }: StorageEndpoint,
  credentials: StorageCredentials,
): S3Client {
  return new S3Client({
    ...awsClientSettingsOf(proxy),
    credentials,
    ...(endpoint === undefined ? {} : { endpoint, forcePathStyle: true }),
    ...(region === undefined ? {} : { region }),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
