import { connect } from 'node:http2';
import { setTimeout } from 'node:timers/promises';

import { Option, Schema } from 'effect';

export type PortAnswer = 'Temporal' | 'nothing' | 'something else';

const systemInfo = '/temporal.api.workflowservice.v1.WorkflowService/GetSystemInfo';

const emptyRequest = Uint8Array.of(0, 0, 0, 0, 0);

export const answerPatienceMs = 3000;

interface Exchange {
  headers: unknown;
  trailers: unknown;
  failure: unknown;
}

const headersOf = Schema.decodeUnknownOption(
  Schema.Struct({
    'content-type': Schema.optional(Schema.String),
    'grpc-status': Schema.optional(Schema.String),
  }),
);

const codesOf = Schema.decodeUnknownOption(
  Schema.Struct({
    code: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })),
  }),
);

function refused(failure: unknown): boolean {
  const codes = Option.getOrUndefined(codesOf(failure));
  return [codes?.code, codes?.cause?.code].includes('ECONNREFUSED');
}

function grpcStatusOf(fields: unknown): string | undefined {
  return Option.getOrUndefined(headersOf(fields))?.['grpc-status'];
}

function answerOf({ headers, trailers, failure }: Readonly<Exchange>): PortAnswer {
  if (failure !== undefined) {
    return refused(failure) ? 'nothing' : 'something else';
  }
  const speaksGrpc = Option.getOrUndefined(headersOf(headers))?.['content-type']?.startsWith('application/grpc');
  const status = grpcStatusOf(trailers) ?? grpcStatusOf(headers);
  return speaksGrpc === true && status === '0' ? 'Temporal' : 'something else';
}

export async function whatAnswersOn(address: string): Promise<PortAnswer> {
  const exchange: Exchange = { headers: undefined, trailers: undefined, failure: undefined };
  const fail = (failure: unknown): void => {
    exchange.failure ??= failure;
  };
  const session = connect(`http://${address}`).on('error', fail);
  const call = session.request({
    ':method': 'POST',
    ':path': systemInfo,
    'content-type': 'application/grpc',
    te: 'trailers',
  });
  const { promise: closed, resolve: close } = Promise.withResolvers<boolean>();
  call
    .on('response', (headers: unknown) => {
      exchange.headers = headers;
    })
    .on('trailers', (trailers: unknown) => {
      exchange.trailers = trailers;
    })
    .on('error', fail)
    .on('close', () => {
      close(true);
    });
  call.resume();
  call.end(emptyRequest);
  const answered = await Promise.race([closed, setTimeout(answerPatienceMs, false, { ref: false })]);
  session.destroy();
  return answered ? answerOf(exchange) : 'something else';
}
