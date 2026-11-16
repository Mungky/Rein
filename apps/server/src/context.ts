import type { PermissionMap, UserStatus } from '@rein/shared';
import type { Logger } from 'pino';
import type { GoogleOidc } from './auth/google';
import type { Db } from './db/client';
import type { Session } from './db/schema';
import type { Env } from './env';
import type { FixedWindowLimiter } from './lib/rate-limit';
import type { MailProvider } from './mail/provider';
import type { StorageDriver } from './storage/driver';
import type { WhatsAppProvider } from './wa/provider';

export interface Deps {
  db: Db;
  env: Env;
  logger: Logger;
  mail: MailProvider;
  storage: StorageDriver;
  /** WhatsApp lewat OpenWA (PRD §10.4); NullWhatsApp saat dev/test. */
  wa: WhatsAppProvider;
  /** Batas per file (PRD §7: 50 MB). */
  uploadMaxBytes: number;
  google: GoogleOidc | null;
  limits: {
    /** Kegagalan login per IP: 30 / 15 menit → blokir 15 menit (FR-001 AC3). */
    loginIp: FixedWindowLimiter;
    /** Kirim ulang email verifikasi: 5 / jam per user (PRD §5). */
    emailSend: FixedWindowLimiter;
  };
  /** Folder build SPA; null = server hanya API (dev memakai Vite). */
  webDist: string | null;
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  status: UserStatus;
  roleId: string;
  roleName: string;
  avatarAttachmentId: string | null;
}

export interface AuthContext {
  user: AuthUser;
  session: Session;
  permissions: PermissionMap;
  primaryEmail: string | null;
  emailVerified: boolean;
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    auth: AuthContext | null;
    ip: string;
  };
};
