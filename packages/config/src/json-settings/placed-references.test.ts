import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { misplacedReferences, secretsOfEntry, substituted, type ReferencePlacement } from '../index.ts';

const placement: ReferencePlacement = {
  setting: 'EXAMPLE_CHANNELS',
  entry: 'partner',
  fields: ['headers', 'secret'],
  misplaced: 'Holds a reference, which only headers and secret may hold',
};

const environment = { PARTNER_KEY: 'partner-key-1234', PARTNER_SECRET: 'partner-secret-5678', HOST: 'example.com' };

const written = {
  url: 'https://${HOST}/requests',
  headers: { Authorization: 'Bearer ${PARTNER_KEY}' },
  secret: '${PARTNER_SECRET}',
  fallback: '${MISSING:-none}',
};

describe('the references of an entry', () => {
  const { references } = substituted(written, '/partner', environment);

  it('are refused in every field but those that hold secrets, at their places', () => {
    expect(misplacedReferences(placement, references)).toEqual([
      { setting: 'EXAMPLE_CHANNELS', detail: `/partner/url: ${placement.misplaced}` },
      { setting: 'EXAMPLE_CHANNELS', detail: `/partner/fallback: ${placement.misplaced}` },
    ]);
  });

  it('give the secrets of the entry, from the fields that hold them and set values alone', () => {
    const { references: withFallback } = substituted(
      { headers: { Region: '${REGION:-eu}' }, secret: '${PARTNER_SECRET}' },
      '/partner',
      environment,
    );

    expect(secretsOfEntry(placement, references).map((secret) => Redacted.value(secret))).toEqual([
      'partner-key-1234',
      'partner-secret-5678',
    ]);
    expect(secretsOfEntry(placement, withFallback).map((secret) => Redacted.value(secret))).toEqual([
      'partner-secret-5678',
    ]);
  });
});
