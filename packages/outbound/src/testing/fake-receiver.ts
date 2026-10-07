import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Schema } from 'effect';

export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export interface ReceiverAnswer {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly delayMs?: number;
}

export interface FakeReceiver {
  readonly url: string;
  readonly received: () => readonly ReceivedRequest[];
  readonly answerWith: (...answers: readonly ReceiverAnswer[]) => void;
  readonly answerEveryWith: (answer: ReceiverAnswer) => void;
  readonly close: () => Promise<void>;
}

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

function headersOf({ rawHeaders }: IncomingMessage): Readonly<Record<string, string | undefined>> {
  const headers: Record<string, string> = {};
  for (let index = 0; index < rawHeaders.length; index += 2) {
    headers[String(rawHeaders[index]).toLowerCase()] = String(rawHeaders[index + 1]);
  }
  return headers;
}

async function bodyOf(incoming: IncomingMessage): Promise<string> {
  incoming.setEncoding('utf8');
  let text = '';
  for await (const chunk of incoming) {
    text += String(chunk);
  }
  return text;
}

function answered(outgoing: ServerResponse, { status, headers = {}, body = '', delayMs = 0 }: ReceiverAnswer): void {
  setTimeout(() => {
    outgoing.writeHead(status, headers);
    outgoing.end(body);
  }, delayMs);
}

export async function serveFakeReceiver(path = '/requests'): Promise<FakeReceiver> {
  const received: ReceivedRequest[] = [];
  const queued: ReceiverAnswer[] = [];
  const every = { answer: { status: 204 } satisfies ReceiverAnswer };
  const server = createServer();
  server.on('request', (incoming: IncomingMessage, outgoing: ServerResponse) => {
    void bodyOf(incoming).then((body) => {
      received.push({
        method: String(incoming.method),
        path: String(incoming.url),
        headers: headersOf(incoming),
        body,
      });
      answered(outgoing, queued.shift() ?? every.answer);
      return body;
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${portOf(server.address()).port}${path}`,
    received: () => [...received],
    answerWith: (...answers) => {
      queued.push(...answers);
    },
    answerEveryWith: (answer) => {
      every.answer = answer;
    },
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
