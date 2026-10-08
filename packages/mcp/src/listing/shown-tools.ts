import { Predicate, Schema } from 'effect';

import { cutToDescriptionBound } from '../bounds/call-bounds.ts';
import type { ListedTool } from '../bounds/result-text.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { canBeTested, type TestingLists } from '../tool-tests/testing-guard.ts';
import type { ServerTool } from './tool-server.ts';

export interface Showing extends TestingLists {
  readonly secrets: Secrets;
}

type Scrub = (text: string) => string;

const decodeJsonObject = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject));

function scrubbing(scrub: Scrub): (key: string, value: unknown) => unknown {
  return (_key, value) => {
    if (typeof value === 'string') {
      return scrub(value);
    }
    return Predicate.isObject(value)
      ? Object.fromEntries(Object.entries(value).map(([key, item]: readonly [string, unknown]) => [scrub(key), item]))
      : value;
  };
}

function annotationsOf({ annotations }: ListedTool) {
  return annotations === undefined || Object.keys(annotations).length === 0 ? {} : { annotations };
}

export function shownTool(tool: ListedTool, server: string, showing: Showing): ServerTool {
  const { name, description = '', inputSchema } = tool;
  const { scrub } = showing.secrets;
  return {
    name: scrub(name),
    description: cutToDescriptionBound(scrub(description)),
    input_schema: decodeJsonObject(JSON.stringify(inputSchema, scrubbing(scrub))),
    ...annotationsOf(tool),
    testable: canBeTested({ server, tool: name }, tool.annotations, showing),
  };
}
