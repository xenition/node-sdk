import { fail, notFoundHint } from './util';
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

describe('notFoundHint — slug lookups handed an id', () => {
  /**
   * Several modules read by slug while their siblings write by id, both
   * as plain strings, so TypeScript cannot tell them apart. Passing an id
   * to searchSlots() said `unknown resource "<uuid>"` — which reads as
   * "that row is gone" and sends you looking for data that is sitting
   * right there. Cost me a wrong bug report before I spotted it.
   */
  it('explains when the value looks like an id', () => {
    const msg = notFoundHint('resource', 'cca90e47-b4b6-41d0-9428-e68a31300cd2');
    expect(msg).toMatch(/looks like an id/);
    expect(msg).toMatch(/takes a slug/);
  });

  it('stays plain for a genuine slug', () => {
    expect(notFoundHint('resource', 'lab-room-1')).toBe('unknown resource "lab-room-1"');
  });

  it('is not fooled by something merely uuid-ish', () => {
    expect(notFoundHint('event', 'not-a-uuid-at-all')).toBe('unknown event "not-a-uuid-at-all"');
    expect(notFoundHint('event', '12345678-1234-1234-1234-12345678')).toMatch(/^unknown event/);
  });

  it('accepts uppercase uuids', () => {
    expect(notFoundHint('resource', 'CCA90E47-B4B6-41D0-9428-E68A31300CD2')).toMatch(/looks like an id/);
  });
});
