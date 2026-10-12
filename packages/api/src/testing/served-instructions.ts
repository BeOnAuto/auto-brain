import type { DefinitionType, McpEndpoint, RecipeCalls, ServedTools } from '../mcp/instructions.ts';

const managingPlaybooks = ['create_playbook', 'list_playbooks', 'get_playbook', 'update_playbook', 'retire_playbook'];

const insideAPlaybook = [
  'create_definition',
  'list_definitions',
  'get_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'get_run',
  'cancel_run',
  'list_runs',
  'get_run_history',
  'get_playbook_analytics',
  'list_playbook_events',
  'publish_event',
  'list_tool_servers',
  'test_tool_call',
  'list_interactions',
  'answer_interaction',
  'send_run_event',
  'get_guide',
];

export const queriesInsideAPlaybook = [
  'list_definitions',
  'get_definition',
  'get_run',
  'list_runs',
  'get_run_history',
  'get_playbook_analytics',
  'list_playbook_events',
  'list_tool_servers',
  'list_interactions',
  'get_guide',
];

const discovering = ['list_models', 'list_tool_servers'];

export const orgEndpoint: ServedTools = {
  orgTools: [...managingPlaybooks, ...discovering, 'get_guide'],
  playbookTools: [],
};

export const playbookEndpoint: ServedTools = { orgTools: [], playbookTools: insideAPlaybook };

export const ownOrg: ServedTools = {
  orgTools: [...managingPlaybooks, ...discovering],
  playbookTools: insideAPlaybook.filter((name) => !discovering.includes(name)),
};

export const definitionTypes: readonly DefinitionType[] = [
  { type: 'reasoning', noun: 'reasoning function', guide: 'reasoning-function' },
  { type: 'interaction', noun: 'interaction function', guide: 'interaction-function' },
  { type: 'computation', noun: 'computation function', guide: 'computation-function' },
  { type: 'recall', noun: 'recall function', guide: 'recall-function' },
  { type: 'workflow', noun: 'workflow', guide: 'workflow' },
];

export const recipes: readonly RecipeCalls[] = [
  {
    name: 'first-playbook',
    calls: ['list_playbooks', 'create_playbook', 'create_definition', 'test_tool_call', 'run_definition'],
  },
  { name: 'remember', calls: ['list_definitions', 'create_definition', 'update_definition', 'run_definition'] },
  {
    name: 'give-tools',
    calls: ['list_tool_servers', 'test_tool_call', 'create_definition', 'run_definition', 'get_run_history'],
  },
  { name: 'schedule', calls: ['list_definitions', 'create_definition', 'update_definition', 'list_runs', 'get_run'] },
];

export const everyEndpoint: readonly (readonly [McpEndpoint, ServedTools])[] = [
  ['org', orgEndpoint],
  ['playbook', playbookEndpoint],
  ['own org', ownOrg],
];
