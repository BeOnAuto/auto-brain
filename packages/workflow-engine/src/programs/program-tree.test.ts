import { describe, expect, it } from 'vitest';

import { fieldOf, kindOf, listOf, spanOf, textOf } from './program-tree.ts';

describe('the readers of a parse tree', () => {
  it('read a field a node has as it is', () => {
    const node = { kind: 'Call', name: 'length', args: [1], span: { start: 2, end: 8 } };

    expect([fieldOf(node, 'name'), textOf(node, 'name'), kindOf(node), listOf(node, 'args'), spanOf(node)]).toEqual([
      'length',
      'length',
      'Call',
      [1],
      { start: 2, end: 8 },
    ]);
  });

  it('read a field a node lacks, or one of another shape, as nothing: no text, no items and a span at the start', () => {
    const node = { name: 3, args: 'none', span: { start: 'early' } };

    expect([textOf(node, 'name'), kindOf(node), listOf(node, 'args'), listOf(null, 'args'), spanOf(node)]).toEqual([
      '',
      '',
      [],
      [],
      { start: 0, end: 0 },
    ]);
  });
});
