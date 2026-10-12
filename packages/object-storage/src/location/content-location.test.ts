import { describe, expect, it } from 'vitest';

import { contentLocationOf, type ContentLocation } from './content-location.ts';

const located: readonly (readonly [string, ContentLocation])[] = [
  ['s3://brain-content', { bucket: 'brain-content', prefix: '' }],
  ['s3://brain-content/', { bucket: 'brain-content', prefix: '' }],
  [' s3://brain.content.eu/production/brains/ ', { bucket: 'brain.content.eu', prefix: 'production/brains' }],
  ['s3://brain-content//a//b', { bucket: 'brain-content', prefix: 'a/b' }],
  ['s3://brain-content/content%20of%20brains', { bucket: 'brain-content', prefix: 'content of brains' }],
];

describe('the location of the content on object storage', () => {
  it.each(located)('is the bucket and the prefix of %s', (url, location) => {
    expect(contentLocationOf(url)).toEqual(location);
  });

  it.each([
    'brain-content',
    'https://brain-content/prefix',
    's3://',
    's3://ab',
    's3://Brain-Content',
    's3://-brain-content',
    's3://access:secret@brain-content',
    's3://brain-content:9000',
    's3://brain-content/prefix?versioning=on',
    's3://brain-content/prefix#part',
    's3://brain-content/%E0%A4%A',
  ])('is nothing for %s, which is not an S3 URL of a bucket alone and its prefix', (url) => {
    expect(contentLocationOf(url)).toBeUndefined();
  });
});
