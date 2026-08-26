import { fail } from './util';
import { XenitionError } from '../core/errors';

describe('fail() carries an error code', () => {
  /**
   * Found in the lab: startTrial on a user who already had the
   * entitlement surfaced as code UNKNOWN, so an app could only recognise
   * it by matching the message text — which breaks the moment the wording
   * changes.
   */
  it('defaults to VALIDATION_ERROR', () => {
    try {
      fail('Client.method', 'something was wrong');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(XenitionError);
      expect((err as XenitionError).code).toBe('VALIDATION_ERROR');
      expect((err as XenitionError).message).toBe('Client.method: something was wrong');
    }
  });

  it('accepts CONFLICT for state that refuses a valid request', () => {
    try {
      fail('Client.method', 'already exists', 'CONFLICT');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as XenitionError).code).toBe('CONFLICT');
    }
  });

  it('is still an Error, so existing catch blocks keep working', () => {
    expect(() => fail('C.m', 'x')).toThrow(Error);
    expect(() => fail('C.m', 'x')).toThrow(/C\.m: x/);
  });
});
