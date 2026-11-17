import { describe, expect, it } from 'vitest';
import { quietUntil, wibClock, wibDate, wibDayStart } from '../src/lib/format';

const at = (wib: string) => new Date(`${wib}+07:00`);

describe('tanggal & jam WIB', () => {
  it('wibDate memakai zona WIB, bukan UTC', () => {
    // 2026-11-16 23:30 WIB = 16:30 UTC
    expect(wibDate(at('2026-11-16T23:30:00'))).toBe('2026-11-16');
    // 2026-11-17 00:30 WIB = 2026-11-16 17:30 UTC
    expect(wibDate(at('2026-11-17T00:30:00'))).toBe('2026-11-17');
    expect(wibDate(at('2026-11-17T00:30:00'), 1)).toBe('2026-11-18');
    expect(wibDate(at('2026-11-17T00:30:00'), -3)).toBe('2026-11-14');
  });

  it('wibDayStart = 00:00 WIB', () => {
    expect(wibDayStart(at('2026-11-17T06:59:00')).toISOString()).toBe('2026-11-16T17:00:00.000Z');
  });

  it('wibClock', () => {
    expect(wibClock(at('2026-11-17T07:05:00'))).toBe('07:05');
  });
});

describe('jam tenang (PRD §6.2 butir 4)', () => {
  it('di luar jam tenang → null', () => {
    expect(quietUntil(at('2026-11-17T07:00:00'), '21:00:00', '07:00:00')).toBeNull();
    expect(quietUntil(at('2026-11-17T20:59:00'), '21:00:00', '07:00:00')).toBeNull();
  });

  it('malam hari → ditunda ke 07:00 besok', () => {
    const until = quietUntil(at('2026-11-17T21:00:00'), '21:00:00', '07:00:00');
    expect(until?.toISOString()).toBe(at('2026-11-18T07:00:00').toISOString());
  });

  it('dini hari → ditunda ke 07:00 hari yang sama', () => {
    const until = quietUntil(at('2026-11-18T03:15:00'), '21:00', '07:00');
    expect(until?.toISOString()).toBe(at('2026-11-18T07:00:00').toISOString());
  });

  it('rentang tidak melewati tengah malam', () => {
    expect(quietUntil(at('2026-11-17T12:30:00'), '12:00', '13:00')?.toISOString()).toBe(
      at('2026-11-17T13:00:00').toISOString(),
    );
    expect(quietUntil(at('2026-11-17T13:00:00'), '12:00', '13:00')).toBeNull();
  });

  it('awal = akhir → tidak ada jam tenang', () => {
    expect(quietUntil(at('2026-11-17T22:00:00'), '07:00', '07:00')).toBeNull();
  });
});
