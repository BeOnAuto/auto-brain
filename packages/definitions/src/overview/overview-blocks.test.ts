import { describe, expect, it } from 'vitest';

import {
  listedPhrases,
  markdownOf,
  named,
  numberedList,
  sectionOf,
  type Diagram,
  type OverviewBlock,
} from '../index.ts';

function writtenBlock(block: OverviewBlock): string {
  return String(
    markdownOf({ title: 'flow', opening: [], sections: [sectionOf('What it does', block)] }).split(
      '## What it does\n\n',
    )[1],
  );
}

const shaped: Diagram = {
  kind: 'diagram',
  nodes: [{ label: 'By a call', shape: 'terminal' }, { label: 'Choose', shape: 'decision' }, { label: 'Set' }],
  edges: [
    { from: 0, to: 1, dashed: false },
    { from: 1, to: 2, dashed: true, label: 'on error 503' },
    { from: 2, to: 0, dashed: true },
  ],
};

const nested: Diagram = {
  kind: 'diagram',
  nodes: [{ label: 'Outer' }, { label: 'Inner' }, { label: 'Deepest' }, { label: 'Apart' }],
  edges: [],
  groups: [
    { label: 'For each brief', nodes: [0] },
    { label: 'Try', nodes: [1], within: 0 },
    { label: 'In order', nodes: [2], within: 1 },
    { label: 'Ahead', nodes: [3], within: 4 },
    { label: 'Before', nodes: [], within: -1 },
  ],
};

describe('a numbered list of an overview', () => {
  it('is written an item a line, numbered from 1 in its order', () => {
    expect(
      writtenBlock(
        numberedList([
          [named('review'), ' runs\nfirst.'],
          ['Then ', { code: 'set' }, '.'],
        ]),
      ),
    ).toBe('1. **review** runs first.\n2. Then `set`.\n');
  });
});

describe('the shapes and edges of a diagram', () => {
  it('draw a decision and a terminal in their shapes, and a dashed edge with or without its label', () => {
    expect(writtenBlock(shaped)).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  n1(["By a call"])',
        '  n2{"Choose"}',
        '  n3["Set"]',
        '  n1 --> n2',
        '  n2 -.->|"on error 503"| n3',
        '  n3 -.-> n1',
        '```',
        '',
      ].join('\n'),
    );
  });
});

describe('the groups of a diagram', () => {
  it('nest a group within an earlier one it names, and keep at the top a group that names none before it', () => {
    expect(writtenBlock(nested)).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  subgraph g1["For each brief"]',
        '    n1["Outer"]',
        '    subgraph g2["Try"]',
        '      n2["Inner"]',
        '      subgraph g3["In order"]',
        '        n3["Deepest"]',
        '      end',
        '    end',
        '  end',
        '  subgraph g4["Ahead"]',
        '    n4["Apart"]',
        '  end',
        '  subgraph g5["Before"]',
        '  end',
        '```',
        '',
      ].join('\n'),
    );
  });
});

describe('phrases listed in an overview', () => {
  it('join each item as English lists them, with and or with or, and keep the phrases of each', () => {
    expect([
      listedPhrases([], 'and'),
      listedPhrases([[named('a')]], 'or'),
      listedPhrases([[named('a')], ['b']], 'and'),
      listedPhrases([[named('a')], ['b', { code: 'c' }], ['d']], 'or'),
    ]).toEqual([[], [named('a')], [named('a'), ' and ', 'b'], [named('a'), ', ', 'b', { code: 'c' }, ', or ', 'd']]);
  });
});
