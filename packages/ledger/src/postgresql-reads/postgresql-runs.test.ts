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
  it('reads the name and the definition type at the top of the first message, as jsonb without the escapes jsonb refuses, once its text holds both as written, among a thousand runs', async () => {
    const { query, asked } = answeringNothing();
    const ofOneDefinition = { kind: 'runs', type: 'workflow', name: 'qualify-enquiry' } as const;

    await postgresqlRecordedStore(query).readRecorded(alpha, ofOneDefinition, { order: 'desc', limit: 5 });

    expect(asked[0]?.text).toContain(
      "CASE WHEN strpos(message_data ->> 'json', $2) > 0 AND strpos(message_data ->> 'json', $3) > 0 THEN",
    );
    expect(asked[0]?.text).toContain("regexp_replace(message_data ->> 'json', $4, $5, 'gi')::jsonb @> $6::jsonb");
    expect(asked[0]?.text).toContain('ELSE FALSE END AS of_the_definition');
    expect(asked[0]?.text).toContain('TRUE AND f.of_the_definition AS wanted');
    expect(asked[0]?.values).toEqual([
      'emt:default',
      '"name":"qualify-enquiry"',
      '"definition_type":"workflow"',
      String.raw`(\\\\)|\\u(?:0000|d[89a-f][0-9a-f]{2})`,
      String.raw`\1`,
      '{"name":"qualify-enquiry","definition_type":"workflow"}',
      [`${alpha}runs/`],
      1001,
      1000,
      7,
    ]);
  });
});
