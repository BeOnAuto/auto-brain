import {
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  parseJSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/server';
import { Function } from 'effect';

export interface Relaying {
  readonly agent: () => Transport;
  readonly runtime: () => Transport;
  readonly recover: () => Promise<string | undefined>;
  readonly report: (line: string) => void;
}

const internalError = -32_603;

class McpRelay {
  readonly #agent: Transport;
  readonly #runtime: Transport;
  readonly #relaying: Relaying;
  readonly #initializing = new Set<unknown>();
  readonly #ended = Promise.withResolvers<void>();

  constructor(relaying: Relaying) {
    this.#agent = relaying.agent();
    this.#runtime = relaying.runtime();
    this.#relaying = relaying;
  }

  async run(): Promise<void> {
    Object.assign(this.#runtime, {
      onmessage: (message: unknown) => {
        this.#answered(message);
      },
      onerror: (error: Readonly<Error>) => {
        this.#relaying.report(error.message);
      },
    });
    Object.assign(this.#agent, {
      onmessage: (message: unknown) => {
        void this.#forwarded(message);
      },
      onerror: (error: Readonly<Error>) => {
        this.#relaying.report(error.message);
      },
      onclose: () => {
        this.#ended.resolve();
      },
    });
    await this.#runtime.start();
    await this.#agent.start();
    await this.#ended.promise;
    await this.#runtime.close();
  }

  #answered(message: unknown): void {
    if (isJSONRPCResultResponse(message) && this.#initializing.delete(message.id)) {
      const { protocolVersion } = message.result;
      if (typeof protocolVersion === 'string') {
        this.#runtime.setProtocolVersion?.(protocolVersion);
      }
    }
    void this.#agent.send(parseJSONRPCMessage(message));
  }

  async #forwarded(message: unknown): Promise<void> {
    if (isJSONRPCRequest(message) && message.method === 'initialize') {
      this.#initializing.add(message.id);
    }
    const problem = (await this.#sent(message)) === undefined ? undefined : await this.#sentAgain(message);
    if (problem !== undefined) {
      await this.#refused(message, problem);
    }
  }

  #sent(message: unknown): Promise<string | undefined> {
    return Promise.resolve()
      .then(() => this.#runtime.send(parseJSONRPCMessage(message)))
      .then(Function.constUndefined, String);
  }

  async #sentAgain(message: unknown): Promise<string | undefined> {
    return (await this.#relaying.recover()) ?? this.#sent(message);
  }

  async #refused(message: unknown, problem: string): Promise<void> {
    if (!isJSONRPCRequest(message)) {
      this.#relaying.report(`Auto Runtime did not take a message: ${problem}`);
      return;
    }
    await this.#agent.send({ jsonrpc: '2.0', id: message.id, error: { code: internalError, message: problem } });
  }
}

export function relay(relaying: Relaying): Promise<void> {
  return new McpRelay(relaying).run();
}
