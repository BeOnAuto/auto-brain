import { afterEach, describe, expect, it } from 'vitest';

import { routeClientConsole } from './console-routing.ts';

const { warn, debug } = console;

afterEach(() => {
  console.warn = warn;
  console.debug = debug;
});

describe('the console of the MCP client', () => {
  it('sends the lines of the MCP client to every report, and every other line to the console, until the last report goes', () => {
    const written: unknown[][] = [];
    console.warn = (...data: readonly unknown[]) => {
      written.push(['warn', ...data]);
    };
    console.debug = (...data: readonly unknown[]) => {
      written.push(['debug', ...data]);
    };
    const first: string[] = [];
    const second: string[] = [];

    const stopFirst = routeClientConsole((message) => {
      first.push(message);
    });
    const stopSecond = routeClientConsole((message) => {
      second.push(message);
    });
    console.warn('[mcp-sdk] Received a notification for an unknown handler', 7);
    console.debug('Client.connect took', 3);
    console.warn('The server says something else');
    console.debug(42);
    stopFirst();
    console.warn('[mcp-sdk] Received another');
    stopSecond();
    stopSecond();
    console.warn('[mcp-sdk] Received after');

    expect(first).toEqual(['[mcp-sdk] Received a notification for an unknown handler 7', 'Client.connect took 3']);
    expect(second).toEqual([...first, '[mcp-sdk] Received another']);
    expect(written).toEqual([
      ['warn', 'The server says something else'],
      ['debug', 42],
      ['warn', '[mcp-sdk] Received after'],
    ]);
  });
});
