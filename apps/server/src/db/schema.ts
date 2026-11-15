/**
 * Schema database M0 (PRD §4.1–4.2): auth, role & izin, audit, lampiran.
 * Konvensi: PK uuid v7 (dibuat aplikasi), created_at/updated_at timestamptz (UTC).
 * Larangan: tidak ada kolom uang (lihat schema.test.ts).
 */
import { sql } from 'drizzle-orm';
import {
  ATTACHMENT_CATEGORIES,
  ATTACHMENT_OWNER_TYPES,
  CONTACT_KINDS,
  SCOPES,
  USER_STATUSES,
  VERIFICATION_PURPOSES,
} from '@rein/shared';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());
const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const userStatus = pgEnum('user_status', USER_STATUSES);
export const contactKind = pgEnum('contact_kind', CONTACT_KINDS);
export const verificationPurpose = pgEnum('verification_purpose', VERIFICATION_PURPOSES);
export const permissionScope = pgEnum('permission_scope', SCOPES);
export const attachmentOwnerType = pgEnum('attachment_owner_type', ATTACHMENT_OWNER_TYPES);
export const attachmentCategory = pgEnum('attachment_category', ATTACHMENT_CATEGORIES);

export const roles = pgTable('roles', {
  id: id(),
  name: text('name').notNull().unique(),
  divisionLabel: text('division_label').notNull().default(''),
  isSystem: boolean('is_system').notNull().default(false),
  /** Kunci role bawaan seed (manager, admin, …); null untuk role buatan Admin. */
  systemKey: text('system_key').unique(),
  ...timestamps,
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull(),
    scope: permissionScope('scope').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    username: citext('username').notNull().unique(),
    fullName: text('full_name').notNull(),
    avatarAttachmentId: uuid('avatar_attachment_id').references((): AnyPgColumn => attachments.id, {
      onDelete: 'set null',
    }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    googleSub: text('google_sub').unique(),
    status: userStatus('status').notNull().default('invited'),
    /** null sampai user mengaktifkan akun dari undangan. */
    passwordHash: text('password_hash'),
    passwordChangedAt: tz('password_changed_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    /** Awal jendela 15 menit untuk menghitung kegagalan login (FR-001 AC3). */
    failedLoginWindowStart: tz('failed_login_window_start'),
    lockedUntil: tz('locked_until'),
    lastActiveAt: tz('last_active_at'),
    ...timestamps,
  },
  (t) => [index('users_role_idx').on(t.roleId)],
);

export const userContacts = pgTable(
  'user_contacts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: contactKind('kind').notNull(),
    /** email lowercased / nomor E.164 */
    value: text('value').notNull(),
    verifiedAt: tz('verified_at'),
    isPrimary: boolean('is_primary').notNull().default(false),
    pending: boolean('pending').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_contacts_verified_unique')
      .on(t.kind, t.value)
      .where(sql`${t.verifiedAt} is not null`),
    index('user_contacts_user_idx').on(t.userId),
    index('user_contacts_value_idx').on(t.kind, t.value),
  ],
);

export const verificationCodes = pgTable(
  'verification_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => userContacts.id, { onDelete: 'cascade' }),
    purpose: verificationPurpose('purpose').notNull(),
    /** hash kode 6 digit (null untuk tautan saja, mis. aktivasi) */
    codeHash: text('code_hash'),
    /** hash token tautan (magic link / aktivasi) */
    tokenHash: text('token_hash').unique(),
    expiresAt: tz('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: tz('consumed_at'),
    ...timestamps,
  },
  (t) => [index('verification_codes_user_idx').on(t.userId, t.purpose)],
);

export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 128-bit acak dari klien (crypto.randomUUID) */
    deviceId: text('device_id').notNull(),
    label: text('label').notNull().default(''),
    pinHash: text('pin_hash'),
    pinFailedCount: integer('pin_failed_count').notNull().default(0),
    pinDisabledAt: tz('pin_disabled_at'),
    trustedUntil: tz('trusted_until'),
    lastSeenAt: tz('last_seen_at'),
    revokedAt: tz('revoked_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('devices_user_device_unique').on(t.userId, t.deviceId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    /** SHA-256 dari token cookie; token asli tidak pernah disimpan. */
    tokenHash: text('token_hash').notNull().unique(),
    /** true = perangkat trusted → masa berlaku 30 hari sliding; false = 12 jam. */
    trusted: boolean('trusted').notNull().default(false),
    lastSeenAt: tz('last_seen_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    locked: boolean('locked').notNull().default(false),
    revokedAt: tz('revoked_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Append-only: UPDATE/DELETE ditolak trigger (lihat migrasi audit_append_only). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    diffJson: jsonb('diff_json').$type<Record<string, unknown>>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_idx').on(t.actorId, t.createdAt),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    ownerType: attachmentOwnerType('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    category: attachmentCategory('category').notNull().default('general'),
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    width: integer('width'),
    height: integer('height'),
    thumbKey: text('thumb_key'),
    displayKey: text('display_key'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    deletedAt: tz('deleted_at'),
    ...timestamps,
  },
  (t) => [
    index('attachments_owner_idx').on(t.ownerType, t.ownerId),
    index('attachments_sha_idx').on(t.ownerType, t.ownerId, t.sha256),
  ],
);

export type User = typeof users.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
