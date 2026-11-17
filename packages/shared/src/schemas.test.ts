import { describe, expect, it } from 'vitest';
import { loginSchema, passwordSchema, pinSetupSchema, usernameSchema } from './schemas';
import { normalizePhoneId, pinProblem, safeNextPath } from './util';

describe('normalizePhoneId', () => {
  it.each([
    ['0812-3456-7890', '+6281234567890'],
    ['+62 812 3456 7890', '+6281234567890'],
    ['6281234567890', '+6281234567890'],
    ['81234567890', '+6281234567890'],
  ])('%s → %s', (input, out) => {
    expect(normalizePhoneId(input)).toBe(out);
  });

  it('menolak nomor tidak valid', () => {
    expect(normalizePhoneId('12345')).toBeNull();
    expect(normalizePhoneId('+1 555 0100 222')).toBeNull();
  });
});

describe('safeNextPath', () => {
  it('menerima path internal', () => {
    expect(safeNextPath('/p/ABC?x=1')).toBe('/p/ABC?x=1');
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', ''])(
    'menolak %s',
    (v) => {
      expect(safeNextPath(v)).toBe('/');
    },
  );
});

describe('schema', () => {
  it('password minimal 10 karakter', () => {
    expect(passwordSchema.safeParse('pendek').success).toBe(false);
    expect(passwordSchema.safeParse('cukup-panjang-1').success).toBe(true);
  });
  it('username di-lowercase', () => {
    expect(usernameSchema.parse('Rina.P')).toBe('rina.p');
  });
  it('login remember default false', () => {
    expect(loginSchema.parse({ identifier: 'rina', password: 'x' }).remember).toBe(false);
  });
});

describe('util WO', async () => {
  const { woNumberLabel, todayWib, isOverdue } = await import('./util');
  it('label nomor WO', () => {
    expect(woNumberLabel(1)).toBe('WO 01');
    expect(woNumberLabel(120)).toBe('WO 120');
  });
  it('hari ini WIB: 17:00 UTC sudah berganti hari', () => {
    expect(todayWib(new Date('2026-11-15T16:59:00Z'))).toBe('2026-11-15');
    expect(todayWib(new Date('2026-11-15T17:00:00Z'))).toBe('2026-11-16');
  });
  it('terlambat', () => {
    expect(isOverdue('2026-11-10', 'in_progress', '2026-11-16')).toBe(true);
    expect(isOverdue('2026-11-10', 'done', '2026-11-16')).toBe(false);
    expect(isOverdue('2026-11-16', 'todo', '2026-11-16')).toBe(false);
  });
});

describe('PIN (FR-004 AC1)', () => {
  it('menolak semua digit sama dan deret berurutan', () => {
    for (const bad of ['111111', '000000', '123456', '654321', '345678', '987654']) {
      expect(pinProblem(bad), bad).not.toBeNull();
    }
    for (const bad of ['12345', '1234567', '12a456', '']) expect(pinProblem(bad)).not.toBeNull();
  });
  it('menerima PIN biasa', () => {
    for (const ok of ['482915', '135790', '112233', '123465'])
      expect(pinProblem(ok), ok).toBeNull();
  });
  it('pinSetupSchema: konfirmasi harus sama', () => {
    expect(pinSetupSchema.safeParse({ pin: '482915', pinConfirm: '482915' }).success).toBe(true);
    const r = pinSetupSchema.safeParse({ pin: '482915', pinConfirm: '482916' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['pinConfirm']);
  });
});
