import {
  DefaultFailureConverter,
  type FailureConverter,
  type PayloadConverter,
  type ProtoFailure,
} from '@temporalio/common';

const defaults = new DefaultFailureConverter();

export const failureConverter = {
  errorToFailure: (error: unknown, payloadConverter: unknown) => {
    const failure = defaults.errorToFailure(error, payloadConverterOf(payloadConverter));
    for (
      let current: ProtoFailure | null | undefined = failure;
      current !== null && current !== undefined;
      current = current.cause
    ) {
      current.stackTrace = '';
    }
    return failure;
  },
  failureToError: (failure: unknown, payloadConverter: unknown) =>
    defaults.failureToError(protoFailureOf(failure), payloadConverterOf(payloadConverter)),
} satisfies FailureConverter;

function payloadConverterOf(value: unknown): PayloadConverter {
  if (!isPayloadConverter(value)) {
    throw new TypeError('A failure is converted with a payload converter');
  }
  return value;
}

function isPayloadConverter(value: unknown): value is PayloadConverter {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'toPayload') === 'function' &&
    typeof Reflect.get(value, 'fromPayload') === 'function'
  );
}

function protoFailureOf(value: unknown): ProtoFailure {
  if (!isProtoFailure(value)) {
    throw new TypeError('Only a failure converts to an error');
  }
  return value;
}

function isProtoFailure(value: unknown): value is ProtoFailure {
  return typeof value === 'object' && value !== null;
}
