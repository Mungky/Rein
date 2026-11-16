import { z } from 'zod';
import { PERMISSION_KEYS, SCOPES } from './permissions';
import { normalizePhoneId, pinProblem } from './util';

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
  email: z.preprocess(
    (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
    emailSchema.optional(),
  ),
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

export const pinSetupSchema = z
  .object({ pin: z.string(), pinConfirm: z.string() })
  .superRefine((v, ctx) => {
    const problem = pinProblem(v.pin);
    if (problem) ctx.addIssue({ code: 'custom', path: ['pin'], message: problem });
    else if (v.pin !== v.pinConfirm) {
      ctx.addIssue({ code: 'custom', path: ['pinConfirm'], message: 'PIN tidak sama' });
    }
  });

export const pinUnlockSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN harus 6 digit angka'),
});

export const whatsappStartSchema = z.object({ phone: phoneSchema });
export const whatsappVerifySchema = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, 'Masukkan 6 digit kode dari WhatsApp'),
  deviceId: z.uuid().optional(),
});
export const nicknameSchema = z.object({
  nickname: z.string().trim().min(1, 'Isi nama panggilan Anda').max(40, 'Maksimal 40 karakter'),
});

/** FR-092: role & izin. */
export const roleCreateSchema = z.object({
  name: z.string().trim().min(2, req('Nama role')).max(60),
  divisionLabel: z.string().trim().max(60).default(''),
  /** Duplikat izin dari role lain. */
  copyFrom: z.uuid().optional(),
});
export const roleUpdateSchema = z.object({
  name: z.string().trim().min(2, req('Nama role')).max(60).optional(),
  divisionLabel: z.string().trim().max(60).optional(),
});
export const rolePermissionsSchema = z.object({
  permissions: z.array(rolePermissionSchema).max(PERMISSION_KEYS.length),
});

export const userRoleSchema = z.object({ roleId: z.uuid('Role tidak valid') });

export const notificationChannelsSchema = z.object({
  channels: z.enum(['whatsapp', 'email', 'both']),
});
export type NotificationChannels = z.infer<typeof notificationChannelsSchema>['channels'];

export const adminVerifyWhatsAppSchema = z.object({ phone: phoneSchema.optional() });
