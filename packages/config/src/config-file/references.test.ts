import { describe, expect, it } from 'vitest';

import { substituted } from '../index.ts';

describe('the references a substitution finds', () => {
  it('names each reference with its place and the value the environment gave it', () => {
    const value = {
      headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': 'eu' },
      args: ['--key', '${env:LIMITLESS_KEY}', '$$HOME'],
      mode: '${MODE:-production}',
    };

    expect(substituted(value, '/graph', { GRAPH_API_KEY: 'graph-key-1234', LIMITLESS_KEY: 'limitless-5678' })).toEqual({
      value: {
        headers: { Authorization: 'Bearer graph-key-1234', 'X-Region': 'eu' },
        args: ['--key', 'limitless-5678', '$HOME'],
        mode: 'production',
      },
      problems: [],
      references: [
        { pointer: '/graph/headers/Authorization', value: 'graph-key-1234' },
        { pointer: '/graph/args/1', value: 'limitless-5678' },
        { pointer: '/graph/mode', value: null },
      ],
    });
  });

  it('finds no reference in text without one, nor in a value that is not text', () => {
    expect(substituted({ count: 2, on: true, none: null, text: 'plain' }, '', {})).toMatchObject({ references: [] });
  });
});
