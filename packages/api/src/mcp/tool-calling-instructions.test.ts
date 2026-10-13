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
  it('take 1,972 characters on /mcp, 1,577 on the org endpoint and 1,923 on the playbook endpoint', () => {
    expect(
      everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, definitionTypes, recipes).length),
    ).toEqual([1577, 1923, 1972]);
  });
});

describe('what the instructions say of calling a tool', () => {
  const reading = {
    orgTools: ['list_playbooks', 'get_playbook', 'list_models', 'search', 'get_guide'],
    playbookTools: queriesInsideAPlaybook,
  };

  it('say what execute and dry_run do in the sentence on tools, where they are listed, and keep the closing sentence', () => {
    const sentence =
      'may name tools that search finds; execute calls one and shows what it answers, and dry_run what it would check.';

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

  it('name dry_run alone for a key that may only read, whose instructions keep within their bound', () => {
    const lengths = [
      instructionsFor('own org', reading, definitionTypes, recipes),
      instructionsFor(
        'own org',
        { ...reading, orgTools: ['list_playbooks', 'get_playbook', 'search', 'get_guide'] },
        definitionTypes,
        recipes,
      ),
      instructionsFor('org', { orgTools: reading.orgTools, playbookTools: [] }, definitionTypes, recipes),
      instructionsFor('playbook', { orgTools: [], playbookTools: queriesInsideAPlaybook }, definitionTypes, recipes),
    ];

    expect(lengths.filter((instructions) => /\bexecute\b/u.test(instructions))).toEqual([]);
    expect(lengths[0]).toContain('may name tools that search finds; dry_run shows what a call of one would check.');
    expect(lengths.map(({ length }) => length)).toEqual([1659, 1696, 1547, 1656]);
  });
});

describe('what the instructions say of calling a tool, to a key that may only write', () => {
  it('name execute alone for a key that may change a playbook but not read it', () => {
    const writing = { orgTools: ['list_models', 'search'], playbookTools: ['execute'] };

    expect(instructionsFor('own org', writing, definitionTypes, [])).toContain(
      'may name tools that search finds; execute calls one and shows what it answers.',
    );
  });
});
