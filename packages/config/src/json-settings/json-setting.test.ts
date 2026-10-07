import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { decodedJsonSetting, pointerOf, problem } from '../index.ts';

const EntriesSchema = Schema.Record(Schema.String, Schema.Struct({ url: Schema.String }));

describe('a setting that holds JSON', () => {
  it('decodes the value its schema takes', () => {
    expect(decodedJsonSetting('EXAMPLE_SERVERS', '{"graph":{"url":"https://example.com"}}', EntriesSchema)).toEqual(
      Result.succeed({ graph: { url: 'https://example.com' } }),
    );
  });

  it('names its setting and the place of every problem, never the value', () => {
    expect(decodedJsonSetting('EXAMPLE_SERVERS', '{"graph":{"url":1,"key":"secret-value"}}', EntriesSchema)).toEqual(
      Result.fail([
        { setting: 'EXAMPLE_SERVERS', detail: '/graph/key: Expected no excess property' },
        { setting: 'EXAMPLE_SERVERS', detail: '/graph/url: Expected string' },
      ]),
    );
  });

  it('is refused at its root when it is not JSON', () => {
    expect(decodedJsonSetting('EXAMPLE_SERVERS', '{graph', EntriesSchema)).toEqual(
      Result.fail([{ setting: 'EXAMPLE_SERVERS', detail: '/: Expected JSON' }]),
    );
  });
});

describe('the place of a problem', () => {
  it('is a JSON pointer, with its segments escaped, and the root written as /', () => {
    expect(pointerOf(['a/b', 'c~d', 0])).toBe('/a~1b/c~0d/0');
    expect(problem('EXAMPLE', '', 'Expected an object')).toEqual({
      setting: 'EXAMPLE',
      detail: '/: Expected an object',
    });
  });
});
