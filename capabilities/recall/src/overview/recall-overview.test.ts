import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { recallWith } from '../testing/recall-runs.ts';

const page = readFileSync(new URL('../../../../docs/reference/recall-format.md', import.meta.url), 'utf8');

const [reviewsExample = '', announcementsExample = ''] = [...page.matchAll(/```markdown\n([\s\S]*?)```/gu)].map(
  ([, body = '']: readonly string[]) => body,
);

const twoFilters = [
  'language: typescript',
  'source:',
  '  events:',
  '    - { type: run_succeeded, subject: reasoning/review-brief }',
  '    - { type: run_rejected, subject: reasoning/review-brief }',
];

function goldenOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

function overviewOf(frontMatter: readonly string[], answer?: string): string {
  const source = recallDocument(foldOf('return view;', answer), frontMatter.join('\n'));
  return recallWith().prepared(source).overview('reviews');
}

function sectionOf(overview: string, heading: string): string {
  return overview.split(`## ${heading}\n\n`)[1]?.split('\n\n## ')[0] ?? '';
}

function initialOf(initial: string): string {
  return sectionOf(overviewOf([...twoFilters, 'view:', `  initial: ${initial}`]), 'What it keeps');
}

describe('the overviews of the examples of the reference of recall functions', () => {
  it('are, byte for byte, the overviews pinned beside this test', () => {
    const { prepared } = recallWith();

    expect(prepared(reviewsExample).overview('campaign-reviews')).toBe(goldenOf('reference-example.overview.md'));
    expect(prepared(announcementsExample).overview('announcements')).toBe(
      goldenOf('reference-common-case.overview.md'),
    );
  });
});

describe('how the view of a recall function is kept, in its overview', () => {
  it('is a diagram from each filter to the view, drawn as a cylinder, and from the view to the answer', () => {
    const overview = overviewOf(twoFilters, 'return view;');

    expect(sectionOf(overview, 'How it is kept').split('\n\n')[0]).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  n1["A run of the reasoning function review-brief succeeds"]',
        '  n2["A run of the reasoning function review-brief is rejected"]',
        '  n3[("The view")]',
        '  n4["The answer of a run"]',
        '  n1 --> n3',
        '  n2 --> n3',
        '  n3 --> n4',
        '```',
      ].join('\n'),
    );
    expect(sectionOf(overview, 'What it remembers')).toMatch(
      /\n\nIt remembers an event that matches more than one of these once\.$/u,
    );
  });
});

describe('what a recall function keeps and answers, in its overview', () => {
  it('says the view it starts with, unless it starts empty', () => {
    expect(initialOf('{ count: 0 }')).toMatch(/\n\nBefore the first event, the view is `\{"count":0\}`\.$/u);
    expect(initialOf('0')).toMatch(/\n\nBefore the first event, the view is `0`\.$/u);
    expect(initialOf(`'${'x'.repeat(300)}'`)).toMatch(
      /\n\nBefore the first event, the view is the value of `view\.initial`, shown under Source\.$/u,
    );
    expect(['{}', '[]', "''", 'null'].map((initial) => initialOf(initial))).toEqual(
      ['{}', '[]', "''", 'null'].map(() =>
        [
          'It keeps one view, which its program updates with each event it remembers:',
          'Any value, which its document does not describe.',
        ].join('\n\n'),
      ),
    );
  });

  it('says a function without an answer answers with its view, and the schema its view is checked against', () => {
    const answered = ['Each run takes:', 'Any input, which its document does not describe.'];

    expect(sectionOf(overviewOf(twoFilters), 'What it answers')).toBe(
      [...answered, 'It answers with the view itself, as it stands.'].join('\n\n'),
    );
    expect(sectionOf(overviewOf([...twoFilters, 'output:', '  schema: { type: object }']), 'What it answers')).toBe(
      [...answered, 'It answers with the view itself, as it stands.', 'A record.'].join('\n\n'),
    );
  });

  it('says what a function with an answer but no schemas takes and answers', () => {
    expect(sectionOf(overviewOf(twoFilters, 'return view;'), 'What it answers')).toBe(
      [
        'Each run takes:',
        'Any input, which its document does not describe.',
        'It answers with what its program makes of the view and that input:',
        'Any output, which its document does not describe.',
      ].join('\n\n'),
    );
  });
});
