import {
  BrainReader,
  PagingInputFields,
  PagingOutputFields,
  defaultPageLimit,
  defineQuery,
  mostExaminedInAPage,
  type RecordedSelection,
} from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { DefinitionTypeField, knownCapabilities } from '../capability/known-capabilities.ts';
import { RunsOfNameField } from '../operations/definition-fields.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { runsListed, runsToList } from '../plain-language/reading-words.ts';
import { RunSchema } from '../runs/run.ts';
import { ListedRunSchema, listedRunsOf } from './listed-run.ts';
import { storedTypesByStatus } from './run-status.ts';

const description = [
  'Lists the runs of the brain a page at a time, newest first, each with its definition, its status, who started it and when it ended, without its output.',
  'Use it to find a run the person means, such as the runs of a scheduled workflow; get_run reads one run in full.',
  '`type` and `name` keep the runs of one definition and `status` those in one status.',
  `A filtered page looks at up to ${mostExaminedInAPage} runs, so it may hold fewer runs than \`limit\`, or none, while has_more is true.`,
  '`cursor` is the next_cursor of the page before.',
].join(' ');

const ListRunsInput = Schema.Struct({
  type: Schema.optionalKey(DefinitionTypeField),
  name: Schema.optionalKey(RunsOfNameField),
  status: Schema.optionalKey(
    RunSchema.fields.status.annotate({
      description: 'Only runs in this status: started, succeeded, rejected or failed',
    }),
  ),
  limit: PagingInputFields.limit,
  cursor: PagingInputFields.cursor,
});

const ListedRunsPage = Schema.Struct({
  runs: Schema.Array(ListedRunSchema),
  ...PagingOutputFields,
});

function streamsOfRuns(type: string | undefined, name: string | undefined): RecordedSelection {
  return {
    kind: 'runs',
    notBeginningWith: ['run_cancel_requested'],
    ...(type === undefined ? {} : { definitionType: type }),
    ...(name === undefined ? {} : { name }),
  };
}

const listRuns = Effect.fnUntraced(function* ({
  type,
  name,
  status,
  limit = defaultPageLimit,
  cursor,
}: typeof ListRunsInput.Type) {
  const page = yield* (yield* BrainReader).readRecorded(streamsOfRuns(type, name), {
    order: 'desc',
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(status === undefined ? {} : { types: storedTypesByStatus[status] }),
  });
  return {
    runs: yield* listedRunsOf(page.records),
    has_more: page.hasMore,
    next_cursor: page.nextCursor,
  };
});

export function defineListRuns(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  const operation = defineQuery('brain', {
    name: 'list_runs',
    title: 'List runs',
    description,
    route: { method: 'GET', path: '/runs' },
    inputSchema: ListRunsInput,
    outputSchema: ListedRunsPage,
    reasons: ['invalid_input'],
    handle: listRuns,
    plainLanguage: {
      task: 'list the runs',
      attempt: (filters) => runsToList(words, filters),
      outcome: (page, filters) => runsListed(words, page, filters),
    },
  });
  return known.publish(operation, 'Only the runs of this type');
}
