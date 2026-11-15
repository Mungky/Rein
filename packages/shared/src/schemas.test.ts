import { describe, expect, it } from 'vitest';
import { loginSchema, passwordSchema, usernameSchema } from './schemas';
import { normalizePhoneId, safeNextPath } from './util';

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
