import { isReadOnly } from '../bounds/tool-results.ts';
import type { AvailableServer, ServerTool, ToolServer } from '../listing/tool-server.ts';
import type { Found, FoundTool, SearchAsked, SearchedServer } from './search-schemas.ts';
import { searchBounds, termWordsOf } from './search-terms.ts';
import { scoreOf, summaryOf } from './tool-scoring.ts';

interface Candidate {
  readonly server: string;
  readonly tool: ServerTool;
}

interface Scored extends Candidate {
  readonly score: number;
}

const keptBy: Readonly<Record<NonNullable<SearchAsked['only']>, (tool: ServerTool) => boolean>> = {
  read: ({ annotations }) => isReadOnly(annotations),
  write: ({ annotations }) => !isReadOnly(annotations),
};

function consideredOn({ tools }: AvailableServer, { only }: SearchAsked): readonly ServerTool[] {
  return only === undefined ? tools : tools.filter((tool) => keptBy[only](tool));
}

export function searchedServer(server: ToolServer, asked: SearchAsked): SearchedServer {
  const { name, type, record_content, connection } = server;
  const fields = { name, type, record_content, ...(connection === undefined ? {} : { connection }) };
  return 'unavailable' in server
    ? { ...fields, unavailable: server.unavailable, because: server.because }
    : { ...fields, tool_count: consideredOn(server, asked).length };
}

function candidatesOn(server: ToolServer, asked: SearchAsked): readonly Candidate[] {
  return 'unavailable' in server ? [] : consideredOn(server, asked).map((tool) => ({ server: server.name, tool }));
}

function inOrder(first: string, second: string): number {
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}

function bestFirst(first: Scored, second: Scored): number {
  if (first.score !== second.score) {
    return second.score - first.score;
  }
  const byTool = inOrder(first.tool.name, second.tool.name);
  return byTool === 0 ? inOrder(first.server, second.server) : byTool;
}

function scoredBy(words: readonly string[]): (candidate: Candidate) => Scored {
  return ({ server, tool }) => ({ server, tool, score: scoreOf(tool, words) });
}

function isFound({ score }: Scored): boolean {
  return score > 0;
}

function bestOf(candidates: readonly Candidate[], terms: string): readonly Candidate[] {
  const scored = scoredBy(termWordsOf(terms));
  return candidates
    .map((candidate) => scored(candidate))
    .filter((each) => isFound(each))
    .toSorted(bestFirst)
    .slice(0, searchBounds.tools);
}

function foundTool({ server, tool }: Candidate): FoundTool {
  return { server, tool: tool.name, summary: summaryOf(tool.description), read_only: isReadOnly(tool.annotations) };
}

export function foundIn(servers: readonly ToolServer[], asked: SearchAsked): Found {
  const candidates = servers.flatMap((server) => candidatesOn(server, asked));
  const listedWhole = candidates.length <= searchBounds.tools ? candidates : [];
  const chosen = asked.terms === undefined ? listedWhole : bestOf(candidates, asked.terms);
  return {
    servers: servers.map((server) => searchedServer(server, asked)),
    tools: chosen.map((candidate) => foundTool(candidate)),
    scopes: servers.map(({ name }) => name),
  };
}
