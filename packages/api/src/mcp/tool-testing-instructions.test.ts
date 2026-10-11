import { describe, expect, it } from 'vitest';

import {
  playbookEndpoint,
  definitionTypes,
  everyEndpoint,
  ownOrg,
  queriesInsideAPlaybook,
  recipes,
} from '../testing/served-instructions.ts';
import { instructionsFor } from './instructions.ts';

describe('the length of the instructions with every tool', () => {
  it('take 1,937 characters on /mcp, 1,578 on the org endpoint and 1,888 on the playbook endpoint', () => {
    expect(
      everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, definitionTypes, recipes).length),
    ).toEqual([1578, 1888, 1937]);
  });
});

describe('what the instructions say of testing a tool', () => {
  const reading = {
    orgTools: ['list_playbooks', 'get_playbook', 'list_models', 'list_tool_servers', 'get_guide'],
    playbookTools: queriesInsideAPlaybook,
  };

  it('say what test_tool_call shows in the sentence on tools, where it is listed, and keep the closing sentence', () => {
    const sentence = 'may name tools that list_tool_servers lists; test_tool_call shows what a tool answers.';

    expect(instructionsFor('own org', ownOrg, definitionTypes, recipes)).toContain(
      `A reasoning function names a model that list_models lists and ${sentence}`,
    );
    expect(instructionsFor('playbook', playbookEndpoint, definitionTypes, recipes)).toContain(
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
        { ...reading, orgTools: ['list_playbooks', 'get_playbook', 'list_tool_servers', 'get_guide'] },
        definitionTypes,
        recipes,
      ),
      instructionsFor('org', { orgTools: reading.orgTools, playbookTools: [] }, definitionTypes, recipes),
      instructionsFor('playbook', { orgTools: [], playbookTools: queriesInsideAPlaybook }, definitionTypes, recipes),
    ];

    expect(lengths.filter((instructions) => instructions.includes('test_tool_call'))).toEqual([]);
    expect(lengths.map(({ length }) => length)).toEqual([1614, 1651, 1548, 1611]);
  });
});
