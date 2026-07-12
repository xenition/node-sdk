import { assertValidTimeZone, localParts, offsetMsAt, zonedWallToUtcMs } from './time';

const NY = 'America/New_York';

describe('offsetMsAt', () => {
  it('reports the standard-time offset (EST, -5h) in winter', () => {
    const utc = Date.parse('2027-01-15T12:00:00Z');
    expect(offsetMsAt(NY, utc)).toBe(-5 * 3_600_000);
  });

  it('reports the daylight-time offset (EDT, -4h) in summer', () => {
    const utc = Date.parse('2027-07-15T12:00:00Z');
    expect(offsetMsAt(NY, utc)).toBe(-4 * 3_600_000);
  });

  it('is zero for UTC', () => {
    expect(offsetMsAt('UTC', Date.parse('2027-03-14T09:00:00Z'))).toBe(0);
  });
});

describe('zonedWallToUtcMs', () => {
  it('converts a winter wall time using the standard offset', () => {
    // 09:00 EST = 14:00Z
    expect(new Date(zonedWallToUtcMs(NY, 2027, 3, 7, 9, 0)).toISOString()).toBe(
      '2027-03-07T14:00:00.000Z',
    );
  });

  it('converts a summer wall time using the daylight offset', () => {
    // 09:00 EDT = 13:00Z
    expect(new Date(zonedWallToUtcMs(NY, 2027, 7, 15, 9, 0)).toISOString()).toBe(
      '2027-07-15T13:00:00.000Z',
    );
  });

  it('is the identity for UTC wall times', () => {
    expect(new Date(zonedWallToUtcMs('UTC', 2027, 3, 14, 9, 30)).toISOString()).toBe(
      '2027-03-14T09:30:00.000Z',
    );
  });

  it('handles the spring-forward transition day (09:00 is already EDT)', () => {
    // 2027-03-14 02:00 → 03:00 local; 09:00 that day is EDT = 13:00Z (not 14:00Z).
    expect(new Date(zonedWallToUtcMs(NY, 2027, 3, 14, 9, 0)).toISOString()).toBe(
      '2027-03-14T13:00:00.000Z',
    );
  });

  it('handles the fall-back transition day (09:00 is back on EST)', () => {
    // 2027-11-07 02:00 → 01:00 local; 09:00 that day is EST = 14:00Z.
    expect(new Date(zonedWallToUtcMs(NY, 2027, 11, 7, 9, 0)).toISOString()).toBe(
      '2027-11-07T14:00:00.000Z',
    );
  });

  it('maps rule boundaries across the spring gap to the right instants', () => {
    // 00:00 EST = 05:00Z, 06:00 EDT = 10:00Z — a 5-hour real span (the 02:00
    // hour never happens).
    expect(new Date(zonedWallToUtcMs(NY, 2027, 3, 14, 0, 0)).toISOString()).toBe(
      '2027-03-14T05:00:00.000Z',
    );
    expect(new Date(zonedWallToUtcMs(NY, 2027, 3, 14, 6, 0)).toISOString()).toBe(
      '2027-03-14T10:00:00.000Z',
    );
  });

  it('maps rule boundaries across the fall overlap to the right instants', () => {
    // 00:00 EDT = 04:00Z, 06:00 EST = 11:00Z — a 7-hour real span (the 01:00
    // hour happens twice).
    expect(new Date(zonedWallToUtcMs(NY, 2027, 11, 7, 0, 0)).toISOString()).toBe(
      '2027-11-07T04:00:00.000Z',
    );
    expect(new Date(zonedWallToUtcMs(NY, 2027, 11, 7, 6, 0)).toISOString()).toBe(
      '2027-11-07T11:00:00.000Z',
    );
  });
});

describe('localParts', () => {
  it('reads the civil date + weekday in the zone', () => {
    // 2027-03-14T02:00Z is still 2027-03-13 (21:00) in New York.
    const p = localParts(NY, Date.parse('2027-03-14T02:00:00Z'));
    expect(p).toEqual({ year: 2027, month: 3, day: 13, weekday: 6 }); // Saturday
  });

  it('rolls to the next civil day once past local midnight', () => {
    // 2027-03-14T05:00Z = 2027-03-14 00:00 EST (local midnight).
    const p = localParts(NY, Date.parse('2027-03-14T05:00:00Z'));
    expect(p).toEqual({ year: 2027, month: 3, day: 14, weekday: 0 }); // Sunday
  });
});

describe('assertValidTimeZone', () => {
  it('accepts a real IANA zone', () => {
    expect(assertValidTimeZone(NY)).toBe(NY);
  });

  it('throws on a bogus zone', () => {
    expect(() => assertValidTimeZone('Mars/Phobos')).toThrow();
  });
});
