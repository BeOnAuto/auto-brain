import { describe, expect, it } from 'vitest';

import {
  brainEndpoint,
  definitionTypes,
  everyEndpoint,
  ownOrg,
  queriesInsideABrain,
  recipes,
} from '../testing/served-instructions.ts';
import { instructionsFor } from './instructions.ts';

describe('the length of the instructions with every tool', () => {
  it('take 1,882 characters on /mcp, 1,514 on the org endpoint and 1,842 on the brain endpoint', () => {
    expect(
      everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, definitionTypes, recipes).length),
    ).toEqual([1514, 1842, 1882]);
  });
});

describe('what the instructions say of testing a tool', () => {
  const reading = {
    orgTools: ['list_brains', 'get_brain', 'list_models', 'list_tool_servers', 'get_guide'],
    brainTools: queriesInsideABrain,
  };

  it('say what test_tool_call shows in the sentence on tools, where it is listed, and keep the closing sentence', () => {
    const sentence = 'may name tools that list_tool_servers lists; test_tool_call shows what a tool answers.';

    expect(instructionsFor('own org', ownOrg, definitionTypes, recipes)).toContain(
      `A reasoning function names a model that list_models lists and ${sentence}`,
    );
    expect(instructionsFor('brain', brainEndpoint, definitionTypes, recipes)).toContain(
      `A reasoning function names a model this server can call, as the reasoning-function guide says, and ${sentence}`,
    );
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes, recipes).endsWith(
            'A tool that cannot do what was asked says why and what to change.',
          ),
      ),
    ).toEqual([]);
  });

  it('leave it out for a key that may only read, whose instructions keep their length but where the org endpoint lists the tool servers', () => {
    const lengths = [
      instructionsFor('own org', reading, definitionTypes, recipes),
      instructionsFor(
        'own org',
        { ...reading, orgTools: ['list_brains', 'get_brain', 'list_tool_servers', 'get_guide'] },
        definitionTypes,
        recipes,
      ),
      instructionsFor('org', { orgTools: reading.orgTools, brainTools: [] }, definitionTypes, recipes),
      instructionsFor('brain', { orgTools: [], brainTools: queriesInsideABrain }, definitionTypes, recipes),
    ];

    expect(lengths.filter((instructions) => instructions.includes('test_tool_call'))).toEqual([]);
    expect(lengths.map(({ length }) => length)).toEqual([1565, 1602, 1487, 1565]);
  });
});
