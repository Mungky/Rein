import { z } from 'zod';
import { PERMISSION_KEYS, SCOPES } from './permissions';
import { normalizePhoneId } from './util';

/** Pesan validasi dalam Bahasa Indonesia. */
const req = (label: string) => `${label} wajib diisi`;

export const PASSWORD_MIN = 10;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,31}$/,
    'Username 3–32 karakter: huruf kecil, angka, titik, _ atau -',
  );

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Format email tidak valid'));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password minimal ${PASSWORD_MIN} karakter`)
  .max(200, 'Password terlalu panjang');

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhoneId(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Nomor WhatsApp tidak valid' });
      return z.NEVER;
    }
    return n;
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, req('Email atau username')).max(254),
  password: z.string().min(1, req('Password')).max(200),
  remember: z.boolean().default(false),
  next: z.string().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const inviteUserSchema = z.object({
  fullName: z.string().trim().min(2, req('Nama')).max(80),
  email: emailSchema,
  username: usernameSchema,
  roleId: z.uuid('Role tidak valid'),
  whatsapp: phoneSchema.optional(),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const activateSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const verifyEmailCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Kode terdiri dari 6 digit'),
});

export const verifyEmailTokenSchema = z.object({
  token: z.string().min(20).max(200),
});

export const tokenOnlySchema = z.object({ token: z.string().min(20).max(200) });

export const rolePermissionSchema = z.object({
  permission: z.enum(PERMISSION_KEYS as [string, ...string[]]),
  scope: z.enum(SCOPES),
});
