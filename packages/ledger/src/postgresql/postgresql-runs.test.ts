import { describe, expect, it } from 'vitest';

import { postgresqlRecordedStore, type Query } from './postgresql-recorded.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answeringNothing(): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text, values });
      return Promise.resolve([]);
    },
  };
}

const alpha = 'brain/acme/alpha/';

describe('a read of the runs of one definition on PostgreSQL', () => {
  it('reads the primitive and the name at the top of the first message, as jsonb without the escapes jsonb refuses, among a thousand runs', async () => {
    const { query, asked } = answeringNothing();
    const ofOneDefinition = { kind: 'executions', primitive: 'orchestration', name: 'qualify-enquiry' } as const;

    await postgresqlRecordedStore(query).readRecorded(alpha, ofOneDefinition, { order: 'desc', limit: 5 });

    expect(asked[0]?.text).toContain(
      "regexp_replace(message_data ->> 'json', $2, $3, 'gi')::jsonb @> $4::jsonb AS of_the_definition",
    );
    expect(asked[0]?.text).toContain('TRUE AND f.of_the_definition AS wanted');
    expect(asked[0]?.values).toEqual([
      'emt:default',
      String.raw`(\\\\)|\\u(?:0000|d[89a-f][0-9a-f]{2})`,
      String.raw`\1`,
      '{"primitive":"orchestration","name":"qualify-enquiry"}',
      [`${alpha}executions/`],
      1001,
      1000,
      7,
    ]);
  });
});
