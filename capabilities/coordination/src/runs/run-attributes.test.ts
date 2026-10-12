import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { attributesOfRun, storedAttributesOfRun, type RunAttributes } from './run-attributes.ts';

const attributes: RunAttributes = {
  org: 'acme',
  playbook: 'accounts',
  run_id: 'run-1',
  definition: { name: 'payment', version: 2 },
  caller: {
    id: 'operator',
    org: 'acme',
    permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
    playbooks: ['accounts'],
  },
};

const stored = {
  org: 'acme',
  brain: 'accounts',
  run_id: 'run-1',
  definition: { name: 'payment', version: 2 },
  caller: {
    id: 'operator',
    org: 'acme',
    permissions: ['org:read', 'org:write', 'brain:read', 'brain:write'],
    brains: ['accounts'],
  },
};

describe('workflow attributes at the durable boundary', () => {
  it('keeps the stored identity and restricted caller unchanged across the language transition', () => {
    expect(storedAttributesOfRun(attributes)).toEqual(stored);
    expect(attributesOfRun(stored)).toEqual(Option.some(attributes));
  });

  it('reads the public shape without changing its scope', () => {
    expect(attributesOfRun(attributes)).toEqual(Option.some(attributes));
  });

  it('refuses malformed or unknown stored permissions instead of granting access', () => {
    expect(attributesOfRun({ ...stored, caller: { ...stored.caller, permissions: ['admin'] } })).toEqual(Option.none());
    expect(attributesOfRun({ ...stored, caller: { ...stored.caller, brains: undefined } })).toEqual(Option.none());
    expect(attributesOfRun(null)).toEqual(Option.none());
  });
});
