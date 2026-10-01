import { ApplicationFailure, defaultPayloadConverter } from '@temporalio/common';
import { describe, expect, it } from 'vitest';

import { failureConverter } from './failure-converter.ts';

describe('the failure converter', () => {
  it('records a failure without the stack traces of the worker, down its causes', () => {
    const error = ApplicationFailure.create({
      message: 'outer',
      type: 'Outer',
      cause: new Error('inner'),
    });

    const failure = failureConverter.errorToFailure(error, defaultPayloadConverter);

    expect(error.stack).toContain('failure-converter.test.ts');
    expect(failure).toMatchObject({ message: 'outer', stackTrace: '', cause: { message: 'inner', stackTrace: '' } });
  });

  it('turns a failure back into an error', () => {
    const failure = failureConverter.errorToFailure(
      ApplicationFailure.nonRetryable('gone', 'Gone'),
      defaultPayloadConverter,
    );

    expect(failureConverter.failureToError(failure, defaultPayloadConverter)).toMatchObject({
      message: 'gone',
      type: 'Gone',
      nonRetryable: true,
    });
  });

  it('refuses a payload converter that is not one, and a failure that is not one', () => {
    expect(() => failureConverter.errorToFailure(new Error('x'), 'none')).toThrow(
      'A failure is converted with a payload converter',
    );
    expect(() => failureConverter.failureToError('none', defaultPayloadConverter)).toThrow(
      'Only a failure converts to an error',
    );
  });
});
