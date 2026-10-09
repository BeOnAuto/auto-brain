import { Result } from 'effect';
import { filters, tags } from 'liquidjs';
import { describe, expect, it } from 'vitest';

import type { TemplateIssue } from './compiled-template.ts';
import { compileTemplate } from './template-compilation.ts';

const keptFilters = [
  'abs',
  'append',
  'array_to_sentence_string',
  'at_least',
  'at_most',
  'base64_decode',
  'base64_encode',
  'capitalize',
  'ceil',
  'compact',
  'concat',
  'default',
  'divided_by',
  'downcase',
  'escape',
  'escape_once',
  'find',
  'find_index',
  'first',
  'floor',
  'group_by',
  'has',
  'join',
  'json',
  'last',
  'lstrip',
  'map',
  'minus',
  'modulo',
  'newline_to_br',
  'normalize_whitespace',
  'number_of_words',
  'plus',
  'pop',
  'prepend',
  'push',
  'raw',
  'reject',
  'remove',
  'remove_first',
  'remove_last',
  'replace',
  'replace_first',
  'replace_last',
  'reverse',
  'round',
  'rstrip',
  'shift',
  'size',
  'slice',
  'slugify',
  'sort',
  'sort_natural',
  'split',
  'squish',
  'strip',
  'strip_newlines',
  'sum',
  'times',
  'to_integer',
  'truncate',
  'truncatewords',
  'uniq',
  'unshift',
  'upcase',
  'where',
  'xml_escape',
];

const droppedFilters = [
  'where_exp',
  'reject_exp',
  'group_by_exp',
  'has_exp',
  'find_exp',
  'find_index_exp',
  'date',
  'date_to_xmlschema',
  'date_to_rfc822',
  'date_to_string',
  'date_to_long_string',
  'sample',
  'sha256',
  'hmac_sha256',
  'strip_html',
  'url_encode',
  'url_decode',
  'cgi_escape',
  'uri_escape',
  'inspect',
  'jsonify',
];

const keptTags = [
  '{% assign a = 1 %}',
  '{% case input.a %}{% when 1 %}one{% else %}other{% endcase %}',
  '{% comment %}note{% endcomment %}',
  '{% # note %}',
  '{% cycle "a", "b" %}',
  '{% increment n %}{% decrement n %}',
  '{% echo input.a %}',
  '{% for item in input.list %}{% break %}{% continue %}{% endfor %}',
  '{% if input.a %}{% elsif input.b %}{% else %}{% endif %}',
  '{% unless input.a %}{% endunless %}',
  '{% liquid\nassign b = 2\necho b %}',
  '{% raw %}{{ not rendered }}{% endraw %}',
  '{% tablerow item in input.list %}{{ item }}{% endtablerow %}',
];

const removedTags = ['include', 'render', 'layout', 'block', 'capture'];

function issuesOf(body: string): readonly TemplateIssue[] {
  return Result.match(compileTemplate(body, 1), { onSuccess: () => [], onFailure: (issues) => issues });
}

describe('the filters a template may use', () => {
  it.each([...keptFilters, 'money', 'clip', 'words'])('include %s', (filter) => {
    expect(issuesOf(`{{ input.a | ${filter} }}`)).toEqual([]);
  });

  it.each(droppedFilters)('leave out %s', (filter) => {
    expect(issuesOf(`{{ input.a | ${filter} }}`)).toEqual([{ line: 1, detail: `undefined filter: ${filter}` }]);
  });

  it('are every filter of the engine but those left out, and the three added', () => {
    expect(new Set([...keptFilters, ...droppedFilters])).toEqual(new Set(Object.keys(filters)));
  });
});

describe('the tags a template may use', () => {
  it.each(keptTags)('include %s', (body) => {
    expect(issuesOf(body)).toEqual([]);
  });

  it('are every tag of the engine but those that load or capture templates, and the system block', () => {
    expect(new Set(Object.keys(tags))).toEqual(
      new Set([
        ...removedTags,
        'assign',
        'break',
        'case',
        'comment',
        'continue',
        'cycle',
        'decrement',
        'echo',
        'for',
        'if',
        'increment',
        'liquid',
        'raw',
        'tablerow',
        'unless',
        '#',
      ]),
    );
  });
});
