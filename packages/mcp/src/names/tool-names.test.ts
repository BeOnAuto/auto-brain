import { describe, expect, it } from 'vitest';

import { modelFacingNames, type Referring } from './model-facing-names.ts';
import { isToolName, namesEveryTool, toolReferenceOf, writtenOf } from './tool-reference.ts';
import { inWords, toolsInWords } from './tool-words.ts';

const named = (...written: readonly string[]) =>
  modelFacingNames(
    written.map((each): Referring => ({ reference: toolReferenceOf(each) ?? { server: '', tool: '' } })),
  ).map(({ name }) => name);

describe('a tool written in a reason function', () => {
  it('reads server/tool and server/*', () => {
    expect(toolReferenceOf('graph/search')).toEqual({ server: 'graph', tool: 'search' });
    expect(toolReferenceOf('graph/graph.query.v2')).toEqual({ server: 'graph', tool: 'graph.query.v2' });
    expect(toolReferenceOf('graph/*')).toEqual({ server: 'graph', tool: '*' });
    expect(namesEveryTool({ server: 'graph', tool: '*' })).toBe(true);
    expect(namesEveryTool({ server: 'graph', tool: 'search' })).toBe(false);
    expect(writtenOf({ server: 'graph', tool: 'search' })).toBe('graph/search');
  });

  it('refuses what is not server/tool', () => {
    expect(toolReferenceOf('search')).toBeUndefined();
    expect(toolReferenceOf('/search')).toBeUndefined();
    expect(toolReferenceOf('Graph/search')).toBeUndefined();
    expect(toolReferenceOf('graph/sea rch')).toBeUndefined();
    expect(toolReferenceOf('graph/')).toBeUndefined();
    expect(isToolName('x'.repeat(129))).toBe(false);
  });
});

describe('the names the model sees', () => {
  it('names a tool mcp__server__tool, with what a provider refuses mapped to underscores', () => {
    expect(named('graph/search', 'graph/graph.query.v2', 'crm-eu/find-person')).toEqual([
      'mcp__graph__search',
      'mcp__graph__graph_query_v2',
      'mcp__crm_eu__find_person',
    ]);
  });

  it('cuts a name over 64 characters and keeps it apart with a hash', () => {
    const [name] = named(`graph/${'a'.repeat(100)}`);

    expect(name).toHaveLength(64);
    expect(name).toMatch(/^mcp__graph__a{43}_[0-9a-f]{8}$/u);
  });

  it('keeps two tools apart whose names map to the same name', () => {
    const names = named('graph/a.b', 'graph/a_b', 'graph/c');

    expect(names[0]).toMatch(/^mcp__graph__a_b_[0-9a-f]{8}$/u);
    expect(names[1]).toMatch(/^mcp__graph__a_b_[0-9a-f]{8}$/u);
    expect(names[0]).not.toBe(names[1]);
    expect(names[2]).toBe('mcp__graph__c');
  });
});

describe('tools in words', () => {
  it('says a name in lowercase words', () => {
    expect(inWords('getLifelogs')).toBe('get lifelogs');
    expect(inWords('graph.query_v2')).toBe('graph query v2');
    expect(inWords('crm-eu')).toBe('crm eu');
  });

  it('says the tools a run used, by server, once each', () => {
    expect(toolsInWords([])).toBe('no tool');
    expect(toolsInWords([{ server: 'graph', tool: 'search' }])).toBe('the search tool of graph');
    expect(
      toolsInWords([
        { server: 'graph', tool: 'search' },
        { server: 'graph', tool: 'execute' },
        { server: 'graph', tool: 'search' },
        { server: 'limitless', tool: 'getLifelogs' },
      ]),
    ).toBe('the search and execute tools of graph and the get lifelogs tool of limitless');
  });
});
